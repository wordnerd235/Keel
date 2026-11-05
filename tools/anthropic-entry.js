// The Anthropic TypeScript/JS SDK, bundled into one ES module (assets/vendor/anthropic.js).
// Keel loads it only when "Claude with your own API key" is chosen for photo reading.
// Rebuild: cd tools && npm install && npm run build-anthropic
export { default as Anthropic } from "@anthropic-ai/sdk";
