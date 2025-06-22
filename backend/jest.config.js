// codeviz-ai/backend/jest.config.js
/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  testMatch: ["**/__tests__/**/*.ts", "**/?(*.)+(spec|test).ts"],
  moduleFileExtensions: ["ts", "tsx", "js", "jsx", "json", "node"],
  setupFiles: ["dotenv/config"], // Load .env variables for tests
  transform: {
    "^.+\\.ts$": "ts-jest",
  },
  moduleNameMapper: {
    // This helps Jest resolve paths correctly if you use absolute imports later
    "^@common/(.*)$": "<rootDir>/src/common/$1",
    "^@api/(.*)$": "<rootDir>/src/api/$1",
    "^@worker/(.*)$": "<rootDir>/src/worker/$1",
  },
};
