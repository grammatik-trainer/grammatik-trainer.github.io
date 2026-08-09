import type { Metadata } from "next";
import { TrainerApp } from "../components/trainer-app";

export const metadata: Metadata = {
  title: "Wiederholen — Der Die Das Sprint",
  description: "Wiederhole gezielt die deutschen Substantive, die dir noch schwerfallen.",
  alternates: { canonical: "/review/" },
  robots: { index: false, follow: false },
};

export default function ReviewPage() {
  return <TrainerApp initialView="review" />;
}
