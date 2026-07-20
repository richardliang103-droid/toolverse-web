import { NextResponse } from "next/server";

// Vercel supplies this immutable SHA for Git-connected deployments. Returning
// it lets the production health check distinguish a live old deploy from the
// exact commit that triggered the check.
const commit = process.env.VERCEL_GIT_COMMIT_SHA ?? "unknown";
const deploymentId = process.env.VERCEL_DEPLOYMENT_ID ?? "unknown";

export function GET() {
  return NextResponse.json({ commit, deploymentId });
}
