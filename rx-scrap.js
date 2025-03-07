const puppeteer = require("puppeteer");
const fs = require("fs/promises");

const BASE_URL = "https://www.rxlist.com";
const ALPHABET = "abcdefghijklmnopqrstuvwxyz".toUpperCase().split("");

async function scrapeDrugNames(page, letter) {
  console.log(`Scraping drug names for letter: ${letter}`);
  const url = `${BASE_URL}/drugs/alpha_${letter.toLowerCase()}.htm`;
  await page.goto(url, { waitUntil: "domcontentloaded" });

  const drugs = await page.evaluate(() => {
    const drugElements = document.querySelectorAll(".AZ_results li a");
    return Array.from(drugElements).map((el) => ({
      name: el.textContent.trim(),
      link: el.href,
    }));
  });

  return drugs;
}

async function scrapeDrugDetails(page, drug) {
  console.log(`Scraping drug details: ${drug.name}`);
  await page.goto(drug.link, { waitUntil: "domcontentloaded" });

  const details = await page.evaluate(() => {
    const name = document.querySelector("h1")?.textContent.trim() || "";
    const genericName =
      document.querySelector('li[itemprop="name"] span')?.textContent.trim() ||
      "";
    const description =
      document.querySelector(".monograph_cont > p")?.textContent.trim() || "";

    const sideEffectsHeader = Array.from(document.querySelectorAll("h2")).find(
      (el) => el.textContent.toLowerCase().includes("side effects")
    );

    let sideEffects = "";
    if (sideEffectsHeader) {
      console.log("Found 'Side Effects' header.");

      let currentElement = sideEffectsHeader.nextElementSibling;
      while (
        currentElement &&
        (currentElement.tagName === "P" || currentElement.tagName === "UL")
      ) {
        if (currentElement.tagName === "P") {
          sideEffects += currentElement.textContent.trim() + " ";
        } else if (currentElement.tagName === "UL") {
          sideEffects +=
            Array.from(currentElement.querySelectorAll("li"))
              .map((li) => li.textContent.trim())
              .join(" ") + " ";
        }
        currentElement = currentElement.nextElementSibling;
      }
      sideEffects = sideEffects.trim();
    } else {
      console.warn("'Side Effects' header not found.");
    }

    const warningsHeader = Array.from(document.querySelectorAll("h2")).find(
      (el) => el.textContent.includes("Warnings")
    );

    const warnings = warningsHeader
      ? warningsHeader.nextElementSibling
          ?.querySelector("dt")
          ?.textContent.trim() ||
        warningsHeader.nextElementSibling?.textContent.trim() ||
        ""
      : "";

    const dosageHeader = Array.from(
      document.querySelectorAll(".monograph_cont h4")
    ).find((el) => el.textContent.includes("Dosage"));

    const dosage = dosageHeader?.nextElementSibling?.textContent.trim() || "";

    return { name, genericName, description, sideEffects, warnings, dosage };
  });

  return details;
}

(async () => {
  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();

  await page.setUserAgent(
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/110.0.0.0 Safari/537.36"
  );

  for (const letter of ALPHABET) {
    try {
      console.log(`Processing letter: ${letter}`);

      const drugs = await scrapeDrugNames(page, letter);

      const drugLinksFile = `drug_links_${letter.toLowerCase()}.json`;
      await fs.writeFile(drugLinksFile, JSON.stringify(drugs, null, 2));
      console.log(`Drug names and links saved to ${drugLinksFile}`);

      const drugDetails = [];

      for (const drug of drugs) {
        try {
          const details = await scrapeDrugDetails(page, drug);
          drugDetails.push(details);
        } catch (error) {
          console.error(`Error scraping drug: ${drug.name}`, error.message);
        }
      }

      const drugDetailsFile = `drug_details_${letter.toLowerCase()}.json`;
      await fs.writeFile(drugDetailsFile, JSON.stringify(drugDetails, null, 2));
      console.log(`Drug details saved to ${drugDetailsFile}`);
    } catch (error) {
      console.error(`Error processing letter ${letter}:`, error.message);
    }
  }

  await browser.close();
})();
