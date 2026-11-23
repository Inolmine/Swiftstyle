import { buildOpenApi } from "@/lib/docs/spec";

export const dynamic = "force-static";

export function GET() {
  return Response.json(buildOpenApi());
}
