const fs = require("fs");
const path = require("path");

const inputJsonFile = "./drug_details.json";
const outputCsvFile = "./drug_details.csv";

function jsonToCsv(jsonData) {
  if (!Array.isArray(jsonData)) {
    throw new Error("JSON data must be an array of objects.");
  }

  const headers = Object.keys(jsonData[0]);

  const rows = jsonData.map((item) =>
    headers
      .map(
        (header) => `"${(item[header] || "").toString().replace(/"/g, '""')}"`
      )
      .join(",")
  );

  return [headers.join(","), ...rows].join("\n");
}

async function convertJsonToCsv() {
  try {
    const jsonData = JSON.parse(
      await fs.promises.readFile(inputJsonFile, "utf-8")
    );

    const csvData = jsonToCsv(jsonData);

    await fs.promises.writeFile(outputCsvFile, csvData, "utf-8");

    console.log(`CSV file saved to ${outputCsvFile}`);
  } catch (error) {
    console.error("Error converting JSON to CSV:", error.message);
  }
}

convertJsonToCsv();
