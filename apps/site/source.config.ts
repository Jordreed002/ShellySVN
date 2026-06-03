import { defineConfig, defineDocs } from 'fumadocs-mdx/config';
import { metaSchema, pageSchema } from 'fumadocs-core/source/schema';
import { z } from 'zod';

const shellyPageSchema = pageSchema.extend({
  category: z.string().optional(),
  status: z.enum(['available', 'preview', 'planned']).optional(),
  lastReviewed: z.string().optional(),
});

export const docs = defineDocs({
  dir: 'content/docs',
  docs: {
    schema: shellyPageSchema,
    postprocess: {
      includeProcessedMarkdown: true,
    },
  },
  meta: {
    schema: metaSchema,
  },
});

export default defineConfig({
  mdxOptions: {
    // Use the docs preset defaults for table of contents and search indexing.
  },
});
