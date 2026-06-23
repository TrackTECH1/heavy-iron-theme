import { ContentStudioNav } from "@/components/content-studio/ContentStudioNav";
import { PostGeneratorClient } from "@/components/content-studio/PostGeneratorClient";
import { PageHeader } from "@/components/ui";

export default function PostGeneratorPage() {
  return (
    <div>
      <PageHeader
        title="Post Generator"
        subtitle="Pull copy and images from fleet_model_hero, fleet_track_size_media, and fleet_product_media"
      />
      <ContentStudioNav />
      <PostGeneratorClient />
    </div>
  );
}
