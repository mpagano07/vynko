import type { Metadata } from 'next';
import SeoLandingPage from '@/components/marketing/SeoLandingPage';
import { buildSeoMetadata } from '@/lib/marketing/seo-landing';
import { content } from './content';

export const metadata: Metadata = buildSeoMetadata(content);

export default function SistemaParaDistribuidoraPage() {
  return <SeoLandingPage content={content} />;
}
