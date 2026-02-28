import { NextRequest, NextResponse } from "next/server";
import { GoogleGenAI } from "@google/genai";

export async function POST(req: NextRequest) {
  try {
    const { prompt, imageBase64, mimeType } = await req.json();

    const apiKey = process.env.GOOGLE_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { success: false, error: "GOOGLE_API_KEY is not set in your .env.local file" },
        { status: 500 }
      );
    }

    const ai = new GoogleGenAI({ apiKey: apiKey });

    let finalInputData = imageBase64;
    if (finalInputData.startsWith("data:")) {
      finalInputData = finalInputData.split(",")[1];
    }

    // We pass the image as inlineData and ask for it to process it
    // Note: Standard Gemini 2.5 Pro/Flash models are text-in/text-out or multimodal-in/text-out.
    // They cannot output raw image bytes directly via `generateContent` unless using experimental models.
    // However, Google's Imagen 3 model can generate images, but it doesn't take image inputs easily via the standard SDK yet.
    // For this specific use case (Image + Text -> Image), we need to use the `gemini-2.5-pro-experimental` or `gemini-3.0-pro` models
    // OR we use the REST API for the specific `gemini-2.5-flash-image` endpoint which is supported in Google AI Studio.
    // 
    // Let's use the REST API approach for `gemini-2.5-flash-image` since the official Node SDK doesn't fully support its unique output format yet.
    
    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent?key=${apiKey}`;

    const fetchResponse = await fetch(apiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              { text: prompt },
              {
                inlineData: {
                  mimeType: mimeType || "image/jpeg",
                  data: finalInputData,
                },
              },
            ],
          },
        ],
      }),
    });

    if (!fetchResponse.ok) {
      const errorText = await fetchResponse.text();
      throw new Error(`Google API returned status ${fetchResponse.status}: ${errorText}`);
    }

    const data = await fetchResponse.json();

    let finalImageUrl = "";
    if (data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts) {
      const parts = data.candidates[0].content.parts;
      const imagePart = parts.find((p: any) => p.inlineData || p.inline_data);
      if (imagePart) {
        const inlineData = imagePart.inlineData || imagePart.inline_data;
        finalImageUrl = `data:${inlineData.mimeType || "image/png"};base64,${inlineData.data || inlineData.imageBytes}`;
      } else {
        const textPart = parts.find((p: any) => p.text);
        if (textPart) {
          throw new Error(`Google AI returned text instead of an image: ${textPart.text.substring(0, 100)}...`);
        }
      }
    }

    if (!finalImageUrl) {
      throw new Error("No image was returned by the API.");
    }

    return NextResponse.json({ success: true, resultUrl: finalImageUrl });
  } catch (err: any) {
    console.error("Generation failed:", err);
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
