"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { DropZone } from "@/ui/DropZone";
import { Banner } from "@/ui/Banner";
import { useToast } from "@/ui/ToastProvider";
import { uploadDocument } from "./actions";

interface UploadError {
  title: string;
  message: string;
  remediation: string;
}

export default function Home() {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<UploadError | null>(null);
  const router = useRouter();
  const toast = useToast();

  function handleFile(file: File) {
    setError(null);
    const form = new FormData();
    form.set("file", file);
    startTransition(async () => {
      const result = await uploadDocument(form);
      if (!result.ok) {
        setError({ title: "That upload did not work", message: result.message, remediation: result.remediation });
        return;
      }
      toast.show(`Extracted ${file.name}`);
      router.push(`/w/${result.data.workspaceId}`);
    });
  }

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-8 px-6 py-16">
      <div className="flex flex-col gap-2">
        <h1 className="text-xl font-semibold leading-snug text-neutral-100">Financial statements</h1>
        <p className="max-w-[68ch] text-sm leading-relaxed text-neutral-400">
          Upload a filing or workbook. Every extracted figure keeps a link back to the page it came from.
        </p>
      </div>

      {error && (
        <Banner
          severity="blocking"
          title={error.title}
          message={error.message}
          remediation={error.remediation}
          onDismiss={() => setError(null)}
        />
      )}

      <DropZone onFile={handleFile} busy={pending} />
    </main>
  );
}
