import { Link } from "wouter";
import { Clapperboard } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ButtonProps } from "@/components/ui/button";

interface OpenVideoEditorButtonProps {
  projectId: string;
  size?: ButtonProps["size"];
  variant?: ButtonProps["variant"];
  className?: string;
  label?: string;
  testId?: string;
}

/**
 * Premium, reusable CTA that opens the Video Editor for a given saved project.
 * Used after a plan is generated, after AI clips are generated, on project
 * cards in My Projects, and in the project detail modal.
 */
export function OpenVideoEditorButton({
  projectId,
  size = "sm",
  variant = "default",
  className = "",
  label = "Open Video Editor",
  testId,
}: OpenVideoEditorButtonProps) {
  return (
    <Link href={`/video-editor?project=${projectId}`}>
      <Button
        size={size}
        variant={variant}
        className={`gold-glow font-bold gap-2 ${className}`}
        data-testid={testId ?? `btn-open-video-editor-${projectId}`}
      >
        <Clapperboard className="h-4 w-4" /> {label}
      </Button>
    </Link>
  );
}
