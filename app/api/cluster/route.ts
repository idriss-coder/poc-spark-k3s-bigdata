import { NextResponse } from "next/server";
import CONFIG from "../../lib/config";

export async function GET() {
  try {
    const res = await fetch(`${CONFIG.CLUSTER_MONITOR_URL}`, {
      cache: "no-store", // Don't cache polling data
    });
    
    if (!res.ok) {
      throw new Error(`Failed to fetch cluster data: ${res.status} ${res.statusText}`);
    }

    const data = await res.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error("Error fetching cluster status:", error);
    return NextResponse.json(
      { error: "Failed to fetch cluster status" },
      { status: 500 }
    );
  }
}
