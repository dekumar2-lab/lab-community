export default {
  async fetch(request, env) {
    const GITHUB_REPO = "dekumar2-lab/lab-community";

    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type"
        }
      });
    }

    try {
      const formData = await request.formData();
      let condoInput = (formData.get("condo") || "Unknown").trim();
      const title = (formData.get("title") || "New Topic").trim();
      const content = formData.get("content") || "";
      const type = formData.get("type") || "wiki";
      // Capture the Urgency Level (defaults to 'medium' if not provided)
      const urgency = formData.get("alert_type") || "medium";

      const folder = condoInput.toLowerCase().replace(/\s+/g, '-');
      const branchName = `contribution-${folder}-${Date.now()}`;
      const headers = {
        "Authorization": `token ${env.GH_TOKEN}`,
        "User-Agent": "Cloudflare-Worker",
        "Accept": "application/vnd.github.v3+json"
      };

      // Helper updated to include layout switching and urgency levels
      const createMD = (t, co, c, tpe, urg) => {
        const layout = tpe === "broadcast" ? "broadcast" : "default";
        const urgencyLine = tpe === "broadcast" ? `urgency: "${urg}"\n` : "";
        const headerPrefix = c.startsWith('# ') ? '' : `# ${t}\n\n`;

        return `---\nlayout: ${layout}\ntitle: "${t}"\ncondo: "${co}"\n${urgencyLine}date: ${new Date().toISOString()}\n---\n\n${headerPrefix}${c}`;
      };

      // Check if this is a new community initialization
      const indexPath = `content/${folder}/index.md`;
      const indexCheck = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/contents/${indexPath}`, { headers });
      const isNewCommunity = indexCheck.status !== 200;

      // 1. Get Master SHA and Create Branch
      const masterRef = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/git/ref/heads/master`, { headers });
      const masterData = await masterRef.json();
      await fetch(`https://api.github.com/repos/${GITHUB_REPO}/git/refs`, {
        method: "POST", headers,
        body: JSON.stringify({ ref: `refs/heads/${branchName}`, sha: masterData.object.sha })
      });

      let filesToCommit = [];

      if (isNewCommunity) {
        // Initialize new community folders
        filesToCommit.push({ path: indexPath, content: createMD("District Overview", condoInput, content, "wiki") });
        filesToCommit.push({ path: `content/${folder}/intelligence.md`, content: createMD("Essential Intelligence", condoInput, "Emergency contacts and utility resources.", "wiki") });
        filesToCommit.push({ path: `content/${folder}/movies.md`, content: createMD("Hub Favorites", condoInput, "Neighbor movie ratings and reviews.", "wiki") });
        filesToCommit.push({ path: `content/${folder}/restaurants.md`, content: createMD("Restaurant Favorites", condoInput, "Local dining recommendations.", "wiki") });
      } else {
        const fileSlug = title.toLowerCase().replace(/\s+/g, '-');

        let finalPath;
        if (type === "broadcast") {
          // Save broadcasts to dedicated folder with urgency metadata
          finalPath = `content/${folder}/broadcasts/${folder}-${fileSlug}-${Date.now()}.md`;
        } else {
          // Save wiki pages to community-specific folder
          finalPath = (fileSlug === 'district-overview' || title === 'District Overview') ? indexPath : `content/${folder}/${fileSlug}.md`;
        }

        filesToCommit.push({ path: finalPath, content: createMD(title, condoInput, content, type, urgency) });
      }

      // 2. Commit files sequentially
      for (const file of filesToCommit) {
        let existingSha = null;
        const fileCheck = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/contents/${file.path}`, { headers });
        if (fileCheck.ok) {
          const fileData = await fileCheck.json();
          existingSha = fileData.sha;
        }

        await fetch(`https://api.github.com/repos/${GITHUB_REPO}/contents/${file.path}`, {
          method: "PUT", headers,
          body: JSON.stringify({
            message: `Update: ${file.path}`,
            content: btoa(unescape(encodeURIComponent(file.content))),
            branch: branchName,
            sha: existingSha
          })
        });
      }

      // 3. Create Pull Request
      const prPayload = {
        title: isNewCommunity ? `Initialize Hub: ${condoInput}` : `Update: ${title} in ${condoInput}`,
        head: branchName,
        base: "master",
        body: `Community Contribution for **${condoInput}**. Type: ${type}${type === 'broadcast' ? ` | Urgency: ${urgency}` : ''}`
      };

      console.log("Creating Pull Request with payload:", JSON.stringify(prPayload, null, 2));

      // 3. Create Pull Request
      const prResponse = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/pulls`, {
        method: "POST", headers,
        body: JSON.stringify({
          title: isNewCommunity ? `Initialize Hub: ${condoInput}` : `Update: ${title} in ${condoInput}`,
          head: branchName, base: "master",
          body: JSON.stringify(prPayload)
        })
      });

      const prResult = await prResponse.json();
      // LOG: GitHub API Response status and result
      console.log(`GitHub PR Response Status: ${prResponse.status}`);
      if (!prResponse.ok) {
        console.error("GitHub PR Error Detail:", JSON.stringify(prResult, null, 2));
      } else {
        console.log("Successfully created PR:", prResult.html_url);
      }

      return new Response(JSON.stringify({ success: true, url: prResult.html_url }), {
        status: 200, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
      });

    } catch (err) {
      return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: { "Access-Control-Allow-Origin": "*" } });
    }
  }
};