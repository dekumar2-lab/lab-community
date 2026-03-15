export default {
  async fetch(request, env) {
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*", // We'll tighten this to your domain before launch
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };

    if (request.method === "OPTIONS")
      return new Response(null, { headers: corsHeaders });

    if (request.method === "POST") {
      try {
        const formData = await request.formData();
        const file = formData.get("file");
        if (!file) return new Response("No file provided", { status: 400 });

        // Clean filename and add timestamp
        const fileName = `wiki-${Date.now()}-${file.name.replace(/[^a-z0-9.]/gi, "_").toLowerCase()}`;

        // Uses the binding you made in Step 2
        await env.WIKI_BUCKET.put(fileName, file.stream(), {
          httpMetadata: { contentType: file.type },
        });

        // Use the Public URL you copied in Step 1
        const publicUrl = `https://pub-9ea84fec129a441f863ae80a67787f61.r2.dev/${fileName}`;

        return new Response(JSON.stringify({ url: publicUrl }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      } catch (err) {
        return new Response(err.message, { status: 500, headers: corsHeaders });
      }
    }
    return new Response("Method not allowed", { status: 405 });
  },
};
