import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { TrainerApp } from "../../components/trainer-app";
import { isCategoryId, nounCategories, nounsForCategory } from "../../lib/data";
import { trainingPath } from "../../lib/routes";
import { resolveMetadataOrigin } from "../../lib/site-origin";

interface CategoryPageProps { params: Promise<{ category: string }> }

export function generateStaticParams() {
  return nounCategories.filter(({ id }) => id !== "all").map(({ id }) => ({ category: id }));
}

export async function generateMetadata({ params }: CategoryPageProps): Promise<Metadata> {
  const categoryId = (await params).category;
  if (!isCategoryId(categoryId) || categoryId === "all") return {};
  const category = nounCategories.find(({ id }) => id === categoryId)!;
  const requestHeaders = await headers();
  const origin = resolveMetadataOrigin(requestHeaders.get("x-forwarded-host"), requestHeaders.get("x-forwarded-proto"));
  const path = trainingPath(categoryId);
  const title = `${category.label} — Der Die Das Sprint`;
  const description = `${category.description}. Trainiere ${nounsForCategory(categoryId).length} deutsche Substantive mit schneller Wiederholung.`;
  return {
    title,
    description,
    alternates: { canonical: path },
    openGraph: { type: "website", url: `${origin}${path}`, siteName: "Der Die Das Sprint", title, description, locale: "de_DE", images: [{ url: `${origin}/og.png`, width: 1200, height: 630, alt: "Der Die Das Sprint — Deutsch. Schnell. Sicher." }] },
    twitter: { card: "summary_large_image", title, description, images: [`${origin}/og.png`] },
  };
}

export default async function CategoryPage({ params }: CategoryPageProps) {
  const category = (await params).category;
  if (!isCategoryId(category) || category === "all") notFound();
  return <TrainerApp initialView="training" initialCategory={category} />;
}
