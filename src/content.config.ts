import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

// Define the Products collection
const products = defineCollection({
  loader: glob({ pattern: '**/[^_]*.{md,mdx}', base: './src/content/products' }),
  schema: z.object({
    title: z.string(),
    price: z.number(),
    image: z.string().optional(),
    description: z.string(),
    ingredients: z.string().optional(),
    available: z.boolean().default(true),
  })
});

// Define the Blog Posts collection
const posts = defineCollection({
  loader: glob({ pattern: '**/[^_]*.{md,mdx}', base: './src/content/posts' }),
  schema: z.object({
    title: z.string(),
    date: z.coerce.date(),
    image: z.string().optional(),
    excerpt: z.string(),
  })
});

// Export all collections
export const collections = { products, posts };
