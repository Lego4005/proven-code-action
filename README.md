# Proven Code — Verifiable AI PR Attestation

**Certify every AI-generated pull request with a cryptographic attestation.**

No source code is uploaded. Only hashes, stats, and metadata.

---

## What It Does

Every time a pull request is opened or updated, Proven Code:

1. **Computes diff stats** — files changed, additions, deletions, per-file SHA-256 hashes
2. **Detects the actor** — human, bot, or AI coding tool (Copilot, Renovate, Dependabot, etc.)
3. **Sends hashes to Proven** — your source code never leaves your repo
4. **Receives a cryptographic attestation** — Ed25519 signed, Merkle-chained, ProvenSeal certified
5. **Posts a badge on the PR** — with a link to the full attestation report

## Privacy Guarantee

| Sent to Proven | NOT Sent |
|---|---|
| File paths | File contents |
| Line counts (+/-) | Actual code |
| SHA-256 hashes | Secrets or env vars |
| PR metadata (title, number) | Comments or reviews |
| Actor identity (login, type) | Personal data |

## Quick Start

### 1. Get an API Key

Sign up at [proven.dev](https://proven.dev) and generate an API key from your dashboard.

### 2. Add the Secret

Go to your repo → Settings → Secrets → Actions → New repository secret:
- Name: `PROVEN_API_KEY`
- Value: your API key from step 1

### 3. Add the Workflow

Create `.github/workflows/proven-code.yml`:

```yaml
name: Proven Code

on:
  pull_request:
    types: [opened, synchronize, reopened]

permissions:
  pull-requests: write
  checks: write

jobs:
  attest:
    runs-on: ubuntu-latest
    name: Certify PR
    steps:
      - name: Checkout code
        uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - name: Run Proven Code Attestation
        uses: Lego4005/proven-code-action@v1
        id: proven
        with:
          proven_api_key: ${{ secrets.PROVEN_API_KEY }}
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}

      - name: Print results
        run: |
          echo "Report: ${{ steps.proven.outputs.report_url }}"
          echo "Seal: ${{ steps.proven.outputs.seal_id }}"
          echo "Badge: ${{ steps.proven.outputs.badge }}"
```

## Modes

### V1: Diff Mode (default)

Attests the raw diff — files changed, line counts, patch hash.

```yaml
with:
  proven_api_key: ${{ secrets.PROVEN_API_KEY }}
  mode: "diff"
```

### V2: Graph Mode

Adds codegraph analysis — function-level changes, module dependencies, alignment scoring, risk assessment.

```yaml
with:
  proven_api_key: ${{ secrets.PROVEN_API_KEY }}
  mode: "graph"
  fail_on_risk: 80  # Fail CI if risk score > 80
```

## Inputs

| Input | Required | Default | Description |
|---|---|---|---|
| `proven_api_key` | Yes | — | Your Proven API key |
| `proven_api_url` | No | `https://proven.dev` | Proven API base URL |
| `mode` | No | `diff` | `diff` (V1) or `graph` (V2) |
| `policy_url` | No | — | URL to your AI code policy |
| `fail_on_risk` | No | `0` | V2: fail if risk > threshold (0 = disabled) |
| `include_patterns` | No | `**/*` | Glob patterns to include (comma-separated) |
| `exclude_patterns` | No | — | Glob patterns to exclude (comma-separated) |

## Outputs

| Output | Description |
|---|---|
| `report_url` | Full attestation report URL |
| `short_id` | Short report ID |
| `seal_id` | ProvenSeal ID (`pv_XXXXXXX`) |
| `badge` | Trust badge: `attested`, `graph_verified`, or `risk_warning` |
| `trust_level` | Trust level string |

## PR Comment

After attestation, a comment is posted on the PR with:

- Trust badge and level
- Link to the full report
- Seal ID for independent verification
- Diff stats summary
- Actor identification
- Privacy notice

## Verification

Every attestation can be independently verified:

- **Online:** Visit `proven.dev/seal/{seal_id}`
- **API:** `GET proven.dev/api/seal/proven/{seal_id}/verify`
- **On Report:** Each report includes the full cryptographic proof chain

## Use Cases

- **AI-Augmented Teams** — Track which PRs were AI-generated vs human-written
- **Compliance** — Prove to auditors that AI code was reviewed and certified
- **Metrics** — Measure AI contribution across your codebase
- **Risk Management** — Gate merges on risk scores (V2)

## License

MIT — see [LICENSE](LICENSE).
