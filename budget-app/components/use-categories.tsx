"use client";
import { useEffect, useState } from "react";
import { api, type Category } from "@/lib/format";

export function useCategories() {
  const [cats, setCats] = useState<Category[]>([]);
  useEffect(() => {
    api<Category[]>("/api/categories").then(setCats).catch(() => {});
  }, []);
  return cats;
}

export function CategoryOptions({ cats }: { cats: Category[] }) {
  const groups = [["fixed", "固定費"], ["variable", "変動費"], ["special", "特別費"]] as const;
  return (
    <>
      <option value="">未分類</option>
      {groups.map(([k, label]) => (
        <optgroup key={k} label={label}>
          {cats.filter((c) => c.kind === k).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </optgroup>
      ))}
    </>
  );
}
