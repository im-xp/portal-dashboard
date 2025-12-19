// Gemini API client for email summarization

const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent';

interface GeminiResponse {
  candidates?: Array<{
    content?: {
      parts?: Array<{
        text?: string;
      }>;
    };
  }>;
  error?: {
    message: string;
  };
}

/**
 * Generate a summary of an email using Gemini
 * @param emailBody - The email body text
 * @param subject - The email subject
 * @param customerEmail - The customer's email address (for context)
 */
export async function summarizeEmail(
  emailBody: string, 
  subject: string,
  customerEmail?: string
): Promise<string | null> {
  const apiKey = process.env.GEMINI_API_KEY;
  
  if (!apiKey) {
    console.warn('[Gemini] API key not configured');
    return null;
  }

  // Truncate very long emails to save tokens
  const truncatedBody = emailBody.length > 3000 
    ? emailBody.slice(0, 3000) + '...[truncated]'
    : emailBody;

  const customerContext = customerEmail ? `\nCustomer email: ${customerEmail}` : '';

  const prompt = `Analyze this customer support email and write a complete summary (2-3 sentences):
- Who is this person and their situation?
- What are they asking or requesting?  
- What action is needed?
${customerContext}
Subject: ${subject}

Email:
${truncatedBody}

Write a complete summary ending with proper punctuation:`;

  try {
    const response = await fetch(`${GEMINI_API_URL}?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          parts: [{ text: prompt }]
        }],
        generationConfig: {
          maxOutputTokens: 1024,
          temperature: 0.3,
        }
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      console.error('[Gemini] API error:', error);
      return null;
    }

    const data: GeminiResponse = await response.json();
    
    if (data.error) {
      console.error('[Gemini] Response error:', data.error.message);
      return null;
    }

    const summary = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
    return summary || null;
  } catch (error) {
    console.error('[Gemini] Error:', error);
    return null;
  }
}

