import { serve } from "std/http";

// Function to handle CORS 
const handleCORS = (req: Request) => {
    const headers = new Headers();
    headers.set("Access-Control-Allow-Origin", "*");
    headers.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    return new Response(null, { headers });
};

// Main handler for the Deno edge function
serve(async (req: Request) => {
    if (req.method === "OPTIONS") {
        return handleCORS(req);
    }

    const { message, system } = await req.json();
    const response = await fetch("https://api.gemini.com/v1/message", {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify({ message, system })
    });

    const data = await response.json();
    return new Response(JSON.stringify(data), { headers: { "Content-Type": "application/json" } });
});