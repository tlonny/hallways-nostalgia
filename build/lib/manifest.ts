import { dirname, relative, sep } from "node:path"

import { GLOBAL_BUILD_MUTEX } from "@build/lib/mutex"
import { type ITask } from "makeboy"
import { number, parse, tuple } from "valibot"

const LEVEL_MANIFEST_VERSION = "coco" as const
const MANIFEST_SPAWN_SCHEMA = tuple([number(), number(), number()])

type ManifestColor = readonly [number, number, number, number]
type ManifestVec3 = readonly [number, number, number]

export enum TextureAddressing {
    Linear = "Linear",
    Nearest = "Nearest",
}

type ManifestMaterial = {
    frames: readonly string[]
    animation_speed?: number
    color?: ManifestColor
    texture_addressing?: TextureAddressing
}

type ManifestPortal = {
    collider: string
    target?: {
        href: string
        name: string
    }
}

type ManifestRootFields = {
    model: string
    collider?: string
    track?: string
    spawn?: ManifestVec3
    materials: Record<string, ManifestMaterial>
}

type Manifest = {
    _version: typeof LEVEL_MANIFEST_VERSION
    portals: Record<string, ManifestPortal>
} & ManifestRootFields

export type ManifestBuildMaterial = {
    name: string
    frames: readonly string[]
    animationSpeed?: number
    color?: ManifestColor
    textureAddressing?: TextureAddressing
}

export type ManifestBuildPortal = ManifestPortal

export type ManifestBuildInput = {
    model: string
    collider?: string
    track?: string
    spawnPath?: string
    materials: readonly ManifestBuildMaterial[]
    portals: Record<string, ManifestBuildPortal>
}

export class ManifestBuild implements ITask {
    constructor(
        private readonly outputPath: string,
        private readonly input: ManifestBuildInput,
    ) {}

    target(): string {
        return this.outputPath
    }

    dependencies(): readonly string[] {
        return []
    }

    force(): boolean {
        return true
    }

    async build(): Promise<void> {
        await GLOBAL_BUILD_MUTEX.lock()
        try {
            console.log(`[task] manifest build: ${this.outputPath}`)
            const outputDirectory = dirname(this.outputPath)
            const manifestRelativePath = (path: string): string => {
                return relative(outputDirectory, path).split(sep).join("/")
            }

            const materials: Record<string, ManifestMaterial> = {}
            for (const item of this.input.materials) {
                const materialValue: ManifestMaterial = {
                    frames: item.frames.map((frame) => manifestRelativePath(frame)),
                }
                if (item.animationSpeed !== undefined) {
                    materialValue.animation_speed = item.animationSpeed
                }
                if (item.color) {
                    materialValue.color = item.color
                }
                if (item.textureAddressing) {
                    materialValue.texture_addressing = item.textureAddressing
                }

                materials[item.name] = materialValue
            }

            let spawn: ManifestVec3 | undefined
            if (this.input.spawnPath) {
                spawn = parse(
                    MANIFEST_SPAWN_SCHEMA,
                    await Bun.file(this.input.spawnPath).json(),
                )
            }

            const portals: Record<string, ManifestPortal> = {}
            for (const [name, entry] of Object.entries(this.input.portals)) {
                const portal: ManifestPortal = {
                    collider: manifestRelativePath(entry.collider),
                }
                if (entry.target) {
                    portal.target = entry.target
                }
                portals[name] = portal
            }

            const rootFields: ManifestRootFields = {
                model: manifestRelativePath(this.input.model),
                materials,
            }
            if (this.input.collider) {
                rootFields.collider = manifestRelativePath(this.input.collider)
            }
            if (this.input.track) {
                rootFields.track = manifestRelativePath(this.input.track)
            }
            if (spawn) {
                rootFields.spawn = spawn
            }

            const manifest: Manifest = {
                _version: LEVEL_MANIFEST_VERSION,
                ...rootFields,
                portals,
            }

            await Bun.write(this.outputPath, JSON.stringify(manifest, null, 2) + "\n")
        } finally {
            GLOBAL_BUILD_MUTEX.unlock()
        }
    }
}
