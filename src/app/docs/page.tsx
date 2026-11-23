import type { Metadata } from "next";
import { ApiDocs } from "@/components/docs/ApiDocs";
import "@/components/docs/docs.css";
import { buildDocs } from "@/lib/docs/spec";

export const metadata: Metadata = {
  title: "Documentation · SwiftStyle",
  robots: { index: false, follow: false },
};

export default function DocsPage() {
  return <ApiDocs docs={buildDocs()} />;
}
