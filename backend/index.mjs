import { GoogleGenerativeAI } from "@google/generative-ai";

// API Key ကို Environment Variable ကနေ ဖတ်ပါမယ်
const genAI = new GoogleGenerativeAI(process.env.GOOGLE_CLOUD_API_KEY);

async function generateContent() {
  try {
    // ၂၀၂၆ ဧပြီလအတွက် အလုပ်လုပ်မယ့် model
    const model = genAI.getGenerativeModel({ 
      model: "gemini-1.5-flash", // gemini-3.1-flash-lite-preview မရသေးရင် ဒါနဲ့ အရင်စမ်းပါ
    });

    console.log("GoHybrid Digital Detective (Node.js) ကို ဆက်သွယ်နေပါပြီ...");

    const prompt = "မင်္ဂလာပါ။ GoHybrid System အတွက် အဆင်သင့်ဖြစ်ပြီလား?";
    const result = await model.generateContent(prompt);
    const response = await result.response;
    
    console.log("\nAI ၏ အဖြေ:");
    console.log(response.text());
    console.log("\n--- Success! ---");

  } catch (error) {
    console.error("\nError ဖြစ်သွားပါသည်:", error.message);
  }
}

generateContent();