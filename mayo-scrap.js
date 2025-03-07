const puppeteer = require("puppeteer");
const fs = require("fs/promises");

// Configuration
const BASE_URL = "https://www.mayoclinic.org/diseases-conditions/index";
const OUTPUT_FOLDER = "mayo_diseases";

// Target sections we want to extract
const TARGET_SECTIONS = [
  "Overview",
  "Symptoms",
  "Causes",
  "Risk factors",
  "Complications",
  "Prevention",
  "Treatment",
  "Diagnosis",
  "When to see a doctor",
];

// Set this to the letter you want to start from ('R' in your case)
const START_FROM_LETTER = "R";

async function scrapeLetters(page) {
  await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".cmp-alphabet-facet--letter a");

  return page.evaluate(() => {
    return Array.from(
      document.querySelectorAll(".cmp-alphabet-facet--letter a")
    ).map((el) => ({ letter: el.textContent.trim(), link: el.href }));
  });
}

async function scrapeDiseases(page, letter) {
  console.log(`Scraping diseases for letter: ${letter.letter}`);

  try {
    // Add retry mechanism for navigation
    let retries = 3;
    while (retries > 0) {
      try {
        await page.goto(letter.link, {
          waitUntil: "domcontentloaded",
          timeout: 60000, // Increase timeout to 60 seconds
        });
        break; // Break out of retry loop if successful
      } catch (e) {
        console.log(
          `Navigation retry for letter ${letter.letter}, attempts left: ${
            retries - 1
          }`
        );
        retries--;
        if (retries === 0) throw e;
        await new Promise((r) => setTimeout(r, 5000)); // Wait 5 seconds before retrying
      }
    }

    // Wait for the disease links to appear
    await page.waitForSelector("a.cmp-result-name__link", { timeout: 10000 });

    return page.evaluate(() => {
      const diseasesList = [];
      document.querySelectorAll("a.cmp-result-name__link").forEach((link) => {
        const href = link.getAttribute("href");
        if (
          href &&
          href.includes("/diseases-conditions/") &&
          href.includes("/syc-")
        ) {
          diseasesList.push({
            name: link.textContent.trim(),
            link: new URL(href, window.location.origin).href,
          });
        }
      });
      return diseasesList;
    });
  } catch (error) {
    console.error(
      `Error scraping diseases for letter ${letter.letter}:`,
      error.message
    );
    return []; // Return empty array if there's an error
  }
}

async function scrapeDiseaseDetails(page, disease) {
  console.log(`Scraping: ${disease.name}`);

  try {
    // Add retry mechanism for navigation
    let retries = 2;
    while (retries > 0) {
      try {
        await page.goto(disease.link, {
          waitUntil: "domcontentloaded",
          timeout: 60000, // Increase timeout to 60 seconds
        });
        break; // Break out of retry loop if successful
      } catch (e) {
        console.log(
          `Navigation retry for disease ${disease.name}, attempts left: ${
            retries - 1
          }`
        );
        retries--;
        if (retries === 0) throw e;
        await new Promise((r) => setTimeout(r, 3000)); // Wait 3 seconds before retrying
      }
    }

    await page.waitForSelector("h1", { timeout: 10000 });
  } catch (error) {
    console.warn(
      `Skipping ${disease.name}, page not loaded properly: ${error.message}`
    );
    return null;
  }

  const details = await page.evaluate((targetSections) => {
    const result = { sections: {} };

    // Get page title
    result.name = document.querySelector("h1")?.textContent.trim() || "";

    // Find all section headers
    const h2Elements = Array.from(
      document.querySelectorAll("h2, .cmp-title__text--h2")
    );

    h2Elements.forEach((h2, index) => {
      const sectionTitle = h2.textContent.trim();

      // Check if this is a section we want
      const isTargetSection = targetSections.some((target) =>
        sectionTitle.toLowerCase().includes(target.toLowerCase())
      );

      if (isTargetSection) {
        // Find the content after this header and before the next header
        let content = "";
        let currentElement = h2.nextElementSibling;
        const nextH2 = h2Elements[index + 1];

        while (currentElement && currentElement !== nextH2) {
          // Skip forms, inputs, subscription elements, etc.
          const shouldSkip =
            currentElement.querySelector("form") ||
            currentElement.querySelector("input") ||
            currentElement.querySelector("button") ||
            currentElement.textContent.includes("Mayo Clinic to your inbox") ||
            currentElement.textContent.includes("Subscribe!") ||
            currentElement.textContent.includes("Request an appointment") ||
            currentElement.textContent.includes("Enlarge image");

          if (
            !shouldSkip &&
            (currentElement.tagName === "P" ||
              currentElement.tagName === "UL" ||
              currentElement.tagName === "OL")
          ) {
            content += currentElement.textContent.trim() + " ";
          }

          currentElement = currentElement.nextElementSibling;
        }

        // Clean up the content
        content = content.replace(/\s+/g, " ").trim();
        if (content) {
          result.sections[sectionTitle] = content;
        }
      }
    });

    return result;
  }, TARGET_SECTIONS);

  // Add URL to the details
  details.url = disease.link;

  return cleanContent(details);
}

function cleanContent(details) {
  // Create a clean copy
  const cleaned = JSON.parse(JSON.stringify(details));

  // Clean each section
  for (const [section, content] of Object.entries(cleaned.sections)) {
    if (typeof content === "string") {
      let cleanedContent = content
        // Remove newsletter signup
        .replace(/From Mayo Clinic to your inbox[\s\S]*?Subscribe!/g, "")
        .replace(
          /Sign up for free and stay up to date[\s\S]*?Click here for an email preview/g,
          ""
        )
        // Remove error messages
        .replace(/Error.*?required|Error.*?valid email/g, "")
        // Remove image captions
        .replace(/Enlarge image[\s\S]*?Close/g, "")
        // Remove appointment forms
        .replace(
          /Request an appointment[\s\S]*?information highlighted below/g,
          ""
        )
        // Remove staff attribution
        .replace(/By Mayo Clinic Staff/g, "")
        // Format bullet points better
        .replace(/\.\s+([A-Z])/g, ".\n• $1");

      // Clean up whitespace
      cleanedContent = cleanedContent.replace(/\s+/g, " ").trim();

      cleaned.sections[section] = cleanedContent;
    }
  }

  return cleaned;
}

(async () => {
  // Create browser and page
  const browser = await puppeteer.launch({
    headless: true,
    defaultViewport: { width: 1280, height: 900 },
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
    ],
  });

  let page;

  try {
    // Create a new page for each letter to avoid frame detachment issues
    page = await browser.newPage();

    // Set user agent and timeouts
    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/110.0.0.0 Safari/537.36"
    );
    page.setDefaultNavigationTimeout(60000);

    // Block images, fonts, and media to speed up scraping
    await page.setRequestInterception(true);
    page.on("request", (req) => {
      const resourceType = req.resourceType();
      if (["image", "font", "media"].includes(resourceType)) {
        req.abort();
      } else {
        req.continue();
      }
    });

    // Create output folder
    await fs.mkdir(OUTPUT_FOLDER, { recursive: true });

    // Get all letters (A-Z)
    const letters = await scrapeLetters(page);

    // Filter letters to start from the specified letter
    const letterIndex = letters.findIndex(
      (l) => l.letter === START_FROM_LETTER
    );
    if (letterIndex === -1) {
      console.error(
        `Letter ${START_FROM_LETTER} not found in the list of letters.`
      );
      await browser.close();
      return;
    }

    const remainingLetters = letters.slice(letterIndex);
    console.log(
      `Will process ${remainingLetters.length} letters starting from ${START_FROM_LETTER}`
    );

    // Process each letter
    for (const letter of remainingLetters) {
      try {
        console.log(`\nProcessing letter: ${letter.letter}`);

        // Create a new page for each letter to avoid frame detachment issues
        await page.close();
        page = await browser.newPage();

        // Re-apply settings for the new page
        await page.setUserAgent(
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/110.0.0.0 Safari/537.36"
        );
        page.setDefaultNavigationTimeout(60000);

        await page.setRequestInterception(true);
        page.on("request", (req) => {
          const resourceType = req.resourceType();
          if (["image", "font", "media"].includes(resourceType)) {
            req.abort();
          } else {
            req.continue();
          }
        });

        // Create folder for this letter
        const letterFolder = `${OUTPUT_FOLDER}/${letter.letter}`;
        await fs.mkdir(letterFolder, { recursive: true });

        // Get all diseases for this letter
        const diseases = await scrapeDiseases(page, letter);
        await fs.writeFile(
          `${letterFolder}/diseases.json`,
          JSON.stringify(diseases, null, 2)
        );

        console.log(
          `Found ${diseases.length} diseases for letter ${letter.letter}`
        );

        // Get details for each disease
        const diseaseDetails = [];

        for (const disease of diseases) {
          try {
            const details = await scrapeDiseaseDetails(page, disease);
            if (details) {
              diseaseDetails.push(details);
            }

            // Delay between requests to avoid overloading the server
            await new Promise((resolve) => setTimeout(resolve, 2000));
          } catch (error) {
            console.error(
              `Error scraping disease: ${disease.name}`,
              error.message
            );
          }
        }

        // Save disease details
        await fs.writeFile(
          `${letterFolder}/disease_details.json`,
          JSON.stringify(diseaseDetails, null, 2)
        );

        console.log(
          `Completed processing ${diseases.length} diseases for letter ${letter.letter}`
        );

        // Add a longer delay between letters
        await new Promise((resolve) => setTimeout(resolve, 5000));
      } catch (error) {
        console.error(
          `Error processing letter ${letter.letter}:`,
          error.message
        );

        // If we encounter an error, create a new page and continue with the next letter
        if (page) await page.close();
        page = await browser.newPage();
      }
    }
  } catch (error) {
    console.error("Fatal error:", error);
  } finally {
    if (page) await page.close();
    await browser.close();
    console.log("Scraping completed!");
  }
})();
