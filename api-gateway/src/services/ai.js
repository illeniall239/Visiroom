require('dotenv').config();
const { logger } = require('./logger');

// Child logger with a fixed `service` label so every AI log line is
// filterable by `jsonPayload.service="ai"` in GCP Cloud Logging.
const log = logger.child({ service: 'ai' });

/**
 * AI Provider Abstraction Layer
 * Integrates with Google AI Studio (Gemini Flash Image)
 */
async function executeGeneration(prompt, imageUrl, options = {}) {
  log.debug({ prompt }, 'Executing generation');

  const apiKey = process.env.GOOGLE_AI_STUDIO_API_KEY;

  if (!apiKey || apiKey === 'your-google-ai-studio-key') {
    log.warn('GOOGLE_AI_STUDIO_API_KEY not set — returning mock image');
    await new Promise(resolve => setTimeout(resolve, 2500));
    return {
      success: true,
      result_url: "https://images.unsplash.com/photo-1555041469-a586c61ea9bc?ixlib=rb-4.0.3&auto=format&fit=crop&w=1000&q=80",
      latency_ms: 2500,
      cost: 0.00
    };
  }

  try {
    const startTime = Date.now();

    // Download the composite image from Supabase Storage and encode as base64
    // so we can pass it inline to Google AI alongside the text prompt
    log.info({ imageUrl }, 'Downloading composite image');
    const imageResponse = await fetch(imageUrl);
    if (!imageResponse.ok) {
      throw new Error(`Failed to download image from Supabase: ${imageResponse.status}`);
    }
    const imageBuffer = await imageResponse.arrayBuffer();
    const base64Image = Buffer.from(imageBuffer).toString('base64');
    const contentType = imageResponse.headers.get('content-type') || 'image/jpeg';
    log.info({ sizeBytes: imageBuffer.byteLength, contentType }, 'Composite image downloaded');

    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent?key=${apiKey}`;

    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          parts: [
            { text: prompt },
            { inlineData: { mimeType: contentType, data: base64Image } }
          ]
        }]
      })
    });

    if (response.status === 429) {
      log.warn({ status: 429 }, 'Google AI rate limited — returning mock image');
      return {
        success: true,
        result_url: "https://images.unsplash.com/photo-1555041469-a586c61ea9bc?ixlib=rb-4.0.3&auto=format&fit=crop&w=1000&q=80",
        latency_ms: 2500,
        cost: 0.00
      };
    }

    if (!response.ok) {
      const errorText = await response.text();
      log.error({ status: response.status, body: errorText }, 'Google AI API error');
      throw new Error(`API returned status ${response.status}`);
    }

    const data = await response.json();
    const latency = Date.now() - startTime;

    let finalImageUrl = "https://images.unsplash.com/photo-1555041469-a586c61ea9bc?ixlib=rb-4.0.3&auto=format&fit=crop&w=1000&q=80";

    if (data.candidates?.[0]?.content?.parts) {
      const parts = data.candidates[0].content.parts;
      const imagePart = parts.find(p => p.inlineData || p.inline_data);

      if (imagePart) {
        const inlineData = imagePart.inlineData || imagePart.inline_data;
        finalImageUrl = `data:${inlineData.mimeType || 'image/png'};base64,${inlineData.data}`;
        log.info({ latencyMs: latency }, 'Generation succeeded');
      } else {
        const textPart = parts.find(p => p.text);
        log.warn({ text: textPart?.text?.substring(0, 200) }, 'Google AI returned text instead of image — using placeholder');
      }
    }

    return {
      success: true,
      result_url: finalImageUrl,
      latency_ms: latency,
      cost: 0.00
    };

  } catch (err) {
    log.error({ err }, 'Generation failed');
    return { success: false, error: err.message };
  }
}

module.exports = { executeGeneration };
