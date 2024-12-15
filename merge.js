const fs = require("fs");
const path = require("path");

const collectedDataDir = "./collected_data";
const outputFile = "./drug_details.json";

async function mergeJsonFiles() {
  try {
    const files = await fs.promises.readdir(collectedDataDir);

    const jsonFiles = files.filter((file) => file.endsWith(".json"));

    const mergedData = [];

    for (const file of jsonFiles) {
      const filePath = path.join(collectedDataDir, file);

      const fileContent = await fs.promises.readFile(filePath, "utf-8");
      const data = JSON.parse(fileContent);

      mergedData.push(...data);
    }

    await fs.promises.writeFile(
      outputFile,
      JSON.stringify(mergedData, null, 2),
      "utf-8"
    );

    console.log(`Merged data saved to ${outputFile}`);
  } catch (error) {
    console.error("Error merging JSON files:", error.message);
  }
}

mergeJsonFiles();
