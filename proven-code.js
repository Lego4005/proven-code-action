/**
 * Proven Code — GitHub Action Entry Point
 *
 * Computes diff stats, builds a pr_attestation_v1 or v2 payload,
 * calls the Proven API, and posts a GitHub Check Run with the result.
 *
 * ZERO source code is uploaded. Only hashes, stats, and metadata.
 */

const core = require("@actions/core");
const github = require("@actions/github");
const crypto = require("crypto");
const { execSync } = require("child_process");

// ─── Helpers ───

function sha256(content) {
  return crypto.createHash("sha256").update(content, "utf8").digest("hex");
}

function execGit(cmd) {
  return execSync(cmd, { encoding: "utf8", maxBuffer: 50 * 1024 * 1024 }).trim();
}

function getInput(name, fallback = "") {
  return core.getInput(name) || fallback;
}

// ─── Diff Computation ───

function computeDiff(baseSha, headSha) {
  // Get the full patch (unified diff)
  let patch = "";
  try {
    patch = execGit(`git diff ${baseSha}...${headSha}`);
  } catch {
    // Fallback: diff against parent
    patch = execGit(`git diff ${baseSha} ${headSha}`);
  }

  const patchSha256 = sha256(patch);

  // Get numstat (additions/deletions per file)
  let numstatRaw = "";
  try {
    numstatRaw = execGit(`git diff --numstat ${baseSha}...${headSha}`);
  } catch {
    numstatRaw = execGit(`git diff --numstat ${baseSha} ${headSha}`);
  }

  const numstat = numstatRaw
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [add, del, file] = line.split("\t");
      return {
        file,
        add: add === "-" ? 0 : parseInt(add, 10),
        del: del === "-" ? 0 : parseInt(del, 10),
      };
    });

  // Get changed files list
  let filesRaw = "";
  try {
    filesRaw = execGit(`git diff --name-status ${baseSha}...${headSha}`);
  } catch {
    filesRaw = execGit(`git diff --name-status ${baseSha} ${headSha}`);
  }

  const filesChanged = filesRaw
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const parts = line.split("\t");
      const status = parts[0];
      const path = parts.length > 2 ? parts[2] : parts[1]; // Handle renames
      const oldPath = parts.length > 2 ? parts[1] : undefined;

      // Compute per-file hash (hash of the file content at HEAD)
      let fileHash = null;
      try {
        const content = execGit(`git show ${headSha}:${path}`);
        fileHash = sha256(content);
      } catch {
        // File might be deleted
        fileHash = null;
      }

      return {
        path,
        status: mapGitStatus(status),
        hash: fileHash,
        ...(oldPath ? { old_path: oldPath } : {}),
      };
    });

  // Apply include/exclude patterns
  const includePatterns = getInput("include_patterns", "**/*")
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
  const excludePatterns = getInput("exclude_patterns", "")
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);

  const filteredFiles = filesChanged.filter((f) => {
    const included =
      includePatterns.length === 0 ||
      includePatterns.some((p) => minimatch(f.path, p));
    const excluded = excludePatterns.some((p) => minimatch(f.path, p));
    return included && !excluded;
  });

  return {
    patch_sha256: patchSha256,
    files_changed: filteredFiles,
    numstat,
  };
}

function mapGitStatus(s) {
  const map = { A: "added", M: "modified", D: "deleted", R: "renamed", C: "copied" };
  return map[s.charAt(0)] || "modified";
}

// Simple glob matching (no dependencies)
function minimatch(filepath, pattern) {
  if (pattern === "**/*") return true;
  if (pattern.startsWith("**/")) {
    const suffix = pattern.slice(3);
    return filepath.endsWith(suffix) || filepath.includes("/" + suffix);
  }
  if (pattern.endsWith("/**")) {
    const prefix = pattern.slice(0, -3);
    return filepath.startsWith(prefix);
  }
  if (pattern.includes("*")) {
    const regex = new RegExp(
      "^" + pattern.replace(/\./g, "\\.").replace(/\*/g, ".*") + "$"
    );
    return regex.test(filepath);
  }
  return filepath === pattern;
}

// ─── Actor Detection ───

function detectActor() {
  const ctx = github.context;
  const sender = ctx.payload?.sender;

  // Check if this is a bot/app
  const isBot =
    sender?.type === "Bot" ||
    ctx.actor?.includes("[bot]") ||
    ctx.actor?.includes("github-actions");

  // Check for common AI coding tools
  const aiTools = [
    "dependabot",
    "renovate",
    "copilot",
    "coderabbit",
    "deepsource",
    "snyk",
    "mend-bolt",
    "imgbot",
    "codecov",
    "sonarcloud",
  ];
  const actorLower = (ctx.actor || "").toLowerCase();
  const isAiTool = aiTools.some((t) => actorLower.includes(t));

  return {
    github_login: ctx.actor || "unknown",
    trigger: isBot || isAiTool ? "bot" : "human",
    tool_signature: isAiTool ? actorLower : sender?.type === "Bot" ? actorLower : null,
  };
}

// ─── V2: Codegraph Stub ───

function computeCodegraph(diff) {
  // V2 placeholder — in production this would use tree-sitter or similar
  // to analyze the AST and detect function/class changes
  const functions = [];
  const modules = [];

  for (const file of diff.files_changed) {
    if (
      file.path.endsWith(".ts") ||
      file.path.endsWith(".js") ||
      file.path.endsWith(".py")
    ) {
      modules.push({
        path: file.path,
        status: file.status,
        hash: file.hash,
      });
    }
  }

  return {
    functions_touched: functions,
    modules_changed: modules,
    dependency_drift: [],
    alignment: {
      score: 0.85,
      flags: [],
      summary: "Basic graph analysis — upgrade to V2 for full AST analysis",
    },
  };
}

// ─── Main ───

async function run() {
  try {
    const ctx = github.context;
    const pr = ctx.payload?.pull_request;

    if (!pr) {
      core.setFailed("Proven Code must run on pull_request events.");
      return;
    }

    const apiKey = getInput("proven_api_key");
    const apiUrl = getInput("proven_api_url", "https://proven.dev");
    const mode = getInput("mode", "diff");
    const policyUrl = getInput("policy_url", "");
    const failOnRisk = parseInt(getInput("fail_on_risk", "0"), 10);

    if (!apiKey) {
      core.setFailed("proven_api_key is required. Get one at proven.dev/dashboard.");
      return;
    }

    core.info("🔐 Proven Code — Computing attestation...");
    core.info(`   Mode: ${mode}`);
    core.info(`   PR: #${pr.number} — ${pr.title}`);
    core.info(`   Base: ${pr.base.sha.slice(0, 8)} → Head: ${pr.head.sha.slice(0, 8)}`);

    // Ensure we have the full git history for diff
    try {
      execGit(`git fetch origin ${pr.base.ref} --depth=1`);
    } catch {
      core.warning("Could not fetch base ref — using available history");
    }

    // 1. Compute diff
    core.info("📊 Computing diff stats...");
    const diff = computeDiff(pr.base.sha, pr.head.sha);
    core.info(
      `   ${diff.files_changed.length} files changed, +${diff.numstat.reduce(
        (s, n) => s + n.add,
        0
      )} -${diff.numstat.reduce((s, n) => s + n.del, 0)}`
    );

    // 2. Detect actor
    const actor = detectActor();
    core.info(`   Actor: ${actor.github_login} (${actor.trigger})`);

    // 3. Build payload
    const schemaVersion =
      mode === "graph" ? "pr_attestation_v2" : "pr_attestation_v1";

    const payload = {
      schema_version: schemaVersion,
      repo: {
        owner: ctx.repo.owner,
        name: ctx.repo.repo,
        visibility: pr.base.repo?.private ? "private" : "public",
        default_branch: pr.base.repo?.default_branch || "main",
      },
      pr: {
        number: pr.number,
        title: pr.title,
        base_sha: pr.base.sha,
        head_sha: pr.head.sha,
        base_ref: pr.base.ref,
        head_ref: pr.head.ref,
        url: pr.html_url,
      },
      diff,
      actor,
      timestamp: new Date().toISOString(),
      ...(policyUrl ? { policy: { url: policyUrl } } : {}),
      ...(mode === "graph"
        ? { codegraph: computeCodegraph(diff) }
        : {}),
    };

    // 4. Call Proven API
    core.info("🚀 Sending attestation to Proven...");
    const response = await fetch(`${apiUrl}/api/proven-code/attest`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errBody = await response.text();
      core.setFailed(`Proven API returned ${response.status}: ${errBody}`);
      return;
    }

    const result = await response.json();
    core.info(`✅ Attestation certified!`);
    core.info(`   Report: ${apiUrl}/r/${result.shortId}`);
    core.info(`   Seal: ${result.sealId || "pending"}`);
    core.info(`   Badge: ${result.badge}`);

    // 5. Set outputs
    core.setOutput("report_url", `${apiUrl}/r/${result.shortId}`);
    core.setOutput("short_id", result.shortId);
    core.setOutput("seal_id", result.sealId || "");
    core.setOutput("badge", result.badge);
    core.setOutput("trust_level", result.trustLevel);

    // 6. Post Check Run comment on PR
    const octokit = github.getOctokit(process.env.GITHUB_TOKEN || "");
    if (process.env.GITHUB_TOKEN) {
      try {
        const badgeEmoji =
          result.badge === "graph_verified"
            ? "🟢"
            : result.badge === "risk_warning"
            ? "🟡"
            : "🔵";

        const body = [
          `## ${badgeEmoji} Proven Code — ${result.badge.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}`,
          "",
          `| Field | Value |`,
          `|-------|-------|`,
          `| **Report** | [${result.shortId}](${apiUrl}/r/${result.shortId}) |`,
          result.sealId
            ? `| **Seal** | [\`${result.sealId}\`](${apiUrl}/seal/${result.sealId}) |`
            : null,
          `| **Trust Level** | ${result.trustLevel} |`,
          `| **Files** | ${diff.files_changed.length} changed |`,
          `| **Lines** | +${diff.numstat.reduce((s, n) => s + n.add, 0)} / -${diff.numstat.reduce((s, n) => s + n.del, 0)} |`,
          `| **Actor** | ${actor.github_login} (${actor.trigger}) |`,
          `| **Patch Hash** | \`${diff.patch_sha256.slice(0, 16)}...\` |`,
          "",
          `> 🔐 No source code was uploaded. Only hashes, stats, and metadata.`,
          `> Verify at [proven.dev/seal/${result.sealId || result.shortId}](${apiUrl}/seal/${result.sealId || result.shortId})`,
        ]
          .filter(Boolean)
          .join("\n");

        await octokit.rest.issues.createComment({
          ...ctx.repo,
          issue_number: pr.number,
          body,
        });
        core.info("💬 Posted attestation comment on PR");
      } catch (commentErr) {
        core.warning(`Could not post PR comment: ${commentErr.message}`);
      }
    }

    // 7. V2: Check risk threshold
    if (mode === "graph" && failOnRisk > 0 && result.riskScore > failOnRisk) {
      core.setFailed(
        `Risk score ${result.riskScore} exceeds threshold ${failOnRisk}. Review the attestation report.`
      );
      return;
    }

    core.info("🎉 Proven Code attestation complete!");
  } catch (error) {
    core.setFailed(`Proven Code failed: ${error.message}`);
  }
}

run();
