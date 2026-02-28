import { GoogleGenAI } from "@google/genai";
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';

dotenv.config();

const genAI = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });

export async function analyzeIssue(description: string, imageUrl?: string) {
  try {
    if (!process.env.GEMINI_API_KEY) {
      console.warn("⚠️ GEMINI_API_KEY not found in .env. Falling back to keyword analysis.");
      return null;
    }

    const prompt = `Analyze this civic issue report. 
    Description: "${description}"
    
    Return a JSON object with:
    1. category: One of ["Roads", "Sanitation", "Drainage", "Electricity", "Water Supply", "Public Safety", "Other"]
    2. priority: One of ["Emergency", "High", "Normal"]
    3. severityScore: 1-10 (10 being most severe)
    4. summary: A 1-sentence concise summary.
    5. isLikelyFake: boolean (true if description is nonsensical or obviously fake)
    
    ONLY return the JSON object, nothing else.`;

    const parts: any[] = [{ text: prompt }];

    if (imageUrl) {
      try {
        const imagePath = path.join(process.cwd(), imageUrl);
        if (fs.existsSync(imagePath)) {
          const imageBuffer = fs.readFileSync(imagePath);
          parts.push({
            inlineData: {
              data: imageBuffer.toString("base64"),
              mimeType: "image/jpeg",
            },
          });
        }
      } catch (e) {
        console.error("Error reading image for AI:", e);
      }
    }

    const result = await genAI.models.generateContent({
      model: "models/gemini-flash-latest",
      contents: [
        {
          role: "user",
          parts: parts
        }
      ]
    });

    const text = result.text;
    
    // Clean up response (Gemini sometimes adds markdown blocks)
    const jsonStr = text.replace(/```json|```/g, "").trim();
    return JSON.parse(jsonStr);
  } catch (err) {
    console.error("AI Analysis Error:", err);
    return null;
  }
}
