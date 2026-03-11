import { json } from '@sveltejs/kit'
import type { Post } from '$lib/types'

const DEFAULT_COVER_IMAGE = '/Sandman%20Logo.png'
const MARKDOWN_IMAGE_REGEX = /!\[[^\]]*\]\(([^)\s]+)(?:\s+['"][^'"]*['"])?\)/

function getFirstImagePath(markdown: string): string | null {
	const match = markdown.match(MARKDOWN_IMAGE_REGEX)
	if (!match) return null

	const imagePath = match[1]
	if (imagePath.startsWith('http://') || imagePath.startsWith('https://') || imagePath.startsWith('/')) {
		return imagePath
	}

	return `/${imagePath.replace(/^\.?\//, '')}`
}

async function getPosts() {
	let posts: Post[] = []

	const paths = import.meta.glob('/src/routes/articles/*.md', { eager: true })
	const rawPaths = import.meta.glob('/src/routes/articles/*.md', {
		eager: true,
		query: '?raw',
		import: 'default'
	}) as Record<string, string>

	for (const path in paths) {
		const file = paths[path]
		const slug = path.split('/').at(-1)?.replace('.md', '')

		if (file && typeof file === 'object' && 'metadata' in file && slug) {
			const metadata = file.metadata as Omit<Post, 'slug'>
			const firstImagePath = getFirstImagePath(rawPaths[path] ?? '')
			const post = {
				...metadata,
				slug,
				coverImage: firstImagePath ?? DEFAULT_COVER_IMAGE
			} satisfies Post
			post.published && posts.push(post)
		}
	}

	posts = posts.sort((first, second) =>
    new Date(second.date).getTime() - new Date(first.date).getTime()
	)

	return posts
}

export async function GET() {
	const posts = await getPosts()
	return json(posts)
}