import fs from "fs";
import OpenAI from "openai";

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const diff = fs.readFileSync("pr.diff", "utf8");

const prompt = `
You are a senior software engineer reviewing a GitHub Pull Request.

Review the following diff.
Focus on:
- bugs
- security risks
- performance issues
- readability
- missing tests
- risky design changes

Write the review in Korean.
Be specific and actionable.
Do not nitpick formatting unless important.

Diff:
${diff.slice(0, 60000)}
`;

const response = await client.responses.create({
  model: "gpt-4.1-mini",
  input: prompt,
});

fs.writeFileSync("review.md", response.output_text);
