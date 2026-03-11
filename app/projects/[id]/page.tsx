import { ProjectDetailContent } from "./project-detail";

type PageProps = {
  params: Promise<{ id: string }>;
};

export default async function ProjectPage({ params }: PageProps) {
  const { id } = await params;
  const projectId = Number(id);

  if (isNaN(projectId)) {
    return (
      <div className="min-h-screen bg-background font-sans flex items-center justify-center">
        <p className="text-destructive text-sm">ID de projet invalide.</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background font-sans">
      <main className="min-h-screen w-full">
        <ProjectDetailContent projectId={projectId} />
      </main>
    </div>
  );
}
