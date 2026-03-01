/**
 * Configuration Constants
 */
const CONFIG = {
  DEFAULT_BRANCH: "master",
  CONTENT_ROOT: "content",
  USER_AGENT: "Cloudflare-Worker-GitHub-Manager",
  GITHUB_REPO: "dekumar2-lab/lab-community",
  CORS_HEADERS: {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json",
  },
};

/**
 * Utility: Create URL-friendly slugs
 */
const slugify = (text) =>
  text
    .toString()
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^\w-]+/g, "");

/**
 * Utility: Generate Markdown content with Frontmatter
 */
const createMarkdown = (title, condo, content, type, urgency) => {
  const layout = type === "broadcast" ? "broadcast" : "default";
  const urgencyLine = type === "broadcast" ? `urgency: "${urgency}"\n` : "";
  const headerPrefix = content.startsWith("# ") ? "" : `# ${title}\n\n`;
  const date = new Date().toISOString();

  return `---
layout: ${layout}
title: "${title}"
condo: "${condo}"
${urgencyLine}date: ${date}
---

${headerPrefix}${content}`;
};

export default {
  async fetch(request, env) {
    // 1. Handle Preflight
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: CONFIG.CORS_HEADERS });
    }

    try {
      // Validate Environment
      if (!env.GH_TOKEN || !CONFIG.GITHUB_REPO) {
        throw new Error(
          "Missing required environment variables: GH_TOKEN or GITHUB_REPO",
        );
      }

      const formData = await request.formData();
      const condoInput = (formData.get("condo") || "Unknown").trim();
      const title = (formData.get("title") || "New Topic").trim();
      const content = formData.get("content") || "";
      const type = formData.get("type") || "wiki";
      const urgency = formData.get("alert_type") || "medium";

      const folder = slugify(condoInput);
      const branchName = `contribution-${folder}-${Date.now()}`;
      const repoUrl = `https://api.github.com/repos/${CONFIG.GITHUB_REPO}`;

      const headers = {
        Authorization: `token ${env.GH_TOKEN}`,
        "User-Agent": CONFIG.USER_AGENT,
        Accept: "application/vnd.github.v3+json",
      };

      // 2. Check for Community Existence
      const indexPath = `${CONFIG.CONTENT_ROOT}/${folder}/index.md`;
      const indexCheck = await fetch(`${repoUrl}/contents/${indexPath}`, {
        headers,
      });
      const isNewCommunity = indexCheck.status !== 200;

      // 3. Create Branch
      const masterRef = await fetch(
        `${repoUrl}/git/ref/heads/${CONFIG.DEFAULT_BRANCH}`,
        { headers },
      );
      const masterData = await masterRef.json();

      const createBranchRes = await fetch(`${repoUrl}/git/refs`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          ref: `refs/heads/${branchName}`,
          sha: masterData.object.sha,
        }),
      });
      if (!createBranchRes.ok) throw new Error("Failed to create git branch");

      // 4. Prepare File Manifest
      let filesToCommit = [];
      if (isNewCommunity) {
        filesToCommit = [
          {
            path: indexPath,
            content: createMarkdown(
              "Community Overview",
              condoInput,
              content,
              "wiki",
            ),
          },
          {
            path: `${CONFIG.CONTENT_ROOT}/${folder}/intelligence.md`,
            content: createMarkdown(
              "Community Essentials",
              condoInput,
              "Emergency contacts.",
              "wiki",
            ),
          },
          {
            path: `${CONFIG.CONTENT_ROOT}/${folder}/movies.md`,
            content: createMarkdown(
              "Hub Favorites",
              condoInput,
              "Neighbor movie ratings.",
              "wiki",
            ),
          },
          {
            path: `${CONFIG.CONTENT_ROOT}/${folder}/restaurants.md`,
            content: createMarkdown(
              "Restaurant Favorites",
              condoInput,
              "Local recommendations.",
              "wiki",
            ),
          },
        ];
      } else {
        const fileSlug = slugify(title);
        const path =
          type === "broadcast"
            ? `${CONFIG.CONTENT_ROOT}/${folder}/broadcasts/${folder}-${fileSlug}-${Date.now()}.md`
            : fileSlug === "community-overview"
              ? indexPath
              : `${CONFIG.CONTENT_ROOT}/${folder}/${fileSlug}.md`;

        filesToCommit.push({
          path,
          content: createMarkdown(title, condoInput, content, type, urgency),
        });
      }

      // 5. Commit Files
      for (const file of filesToCommit) {
        const check = await fetch(`${repoUrl}/contents/${file.path}`, {
          headers,
        });
        const existingSha = check.ok ? (await check.json()).sha : null;

        // Base64 encode using modern Web Crypto compatible method
        const encodedContent = btoa(
          String.fromCharCode(...new TextEncoder().encode(file.content)),
        );

        await fetch(`${repoUrl}/contents/${file.path}`, {
          method: "PUT",
          headers,
          body: JSON.stringify({
            message: `feat(${folder}): add ${file.path}`,
            content: encodedContent,
            branch: branchName,
            sha: existingSha,
          }),
        });
      }

      // 6. Create Pull Request
      const prTitle = isNewCommunity
        ? `Initialize Hub: ${condoInput}`
        : `Update: ${title} in ${condoInput}`;
      const prBody = `### Community Contribution\n- **Condo:** ${condoInput}\n- **Type:** ${type}\n${type === "broadcast" ? `- **Urgency:** ${urgency}` : ""}`;

      const prResponse = await fetch(`${repoUrl}/pulls`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          title: prTitle,
          head: branchName,
          base: CONFIG.DEFAULT_BRANCH,
          body: prBody,
        }),
      });

      const prResult = await prResponse.json();
      if (!prResponse.ok)
        throw new Error(prResult.message || "PR Creation Failed");

      return new Response(
        JSON.stringify({ success: true, url: prResult.html_url }),
        { status: 200, headers: CONFIG.CORS_HEADERS },
      );
    } catch (err) {
      return new Response(
        JSON.stringify({ success: false, error: err.message }),
        { status: 500, headers: CONFIG.CORS_HEADERS },
      );
    }
  },
};
