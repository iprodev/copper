<script lang="ts">
    import type { MascotEmotions } from "$lib/types/mascot";

    type Props = {
        emotion: MascotEmotions;
        forceLoaded?: boolean;
    };

    const { emotion }: Props = $props();
</script>

<!--
    fetchr's mascot: the logo mark on a tilted tile,
    with a small badge that shows the current mood.
-->
<svg
    class="mascot {emotion}"
    width="140"
    height="140"
    viewBox="0 0 140 140"
    fill="none"
    aria-hidden="true"
    xmlns="http://www.w3.org/2000/svg"
>
    <g transform="rotate(-6 64 76)">
        <rect x="14" y="26" width="100" height="100" rx="26" class="tile" />
        <g
            class="mark"
            transform="translate(23 35) scale(3.4)"
            stroke-width="2.4"
            stroke-linecap="round"
            stroke-linejoin="round"
        >
            <path d="M14.5 5.6C13.8 4.6 12.7 4 11.4 4C9.2 4 8 5.4 8 7.8V20" />
            <path d="M4.5 11H12.5" />
            <path d="M12.5 16.5L16 20L19.5 16.5" />
            <path d="M16 20V11.5" />
        </g>
    </g>

    {#if emotion !== "smile"}
        <g transform="translate(112 28)">
            <circle r="20" class="badge" stroke-width="4" />
            <g
                class="glyph"
                transform="scale(1.35)"
                stroke-width="3"
                stroke-linecap="round"
                stroke-linejoin="round"
            >
                {#if emotion === "question"}
                    <path d="M-3 -2.6C-3 -4.6 -1.6 -5.8 0.1 -5.8C1.9 -5.8 3.2 -4.6 3.2 -3C3.2 -0.6 0 -0.4 0 1.8" />
                    <circle cx="0" cy="5.4" r="1.5" class="dot" />
                {:else if emotion === "error"}
                    <path d="M0 -5.6V1.4" />
                    <circle cx="0" cy="5.4" r="1.5" class="dot" />
                {:else if emotion === "think"}
                    <circle cx="-4.6" cy="0" r="1.6" class="dot" />
                    <circle cx="0" cy="0" r="1.6" class="dot" />
                    <circle cx="4.6" cy="0" r="1.6" class="dot" />
                {:else if emotion === "fast"}
                    <path d="M1 -6.5L-3.6 0.8H0.6L-1 6.5L3.8 -1H-0.4Z" class="bolt" stroke-width="1.2" />
                {/if}
            </g>
        </g>
    {/if}
</svg>

<style>
    .mascot {
        display: block;
        margin: 0;
        flex-shrink: 0;
    }

    .tile {
        fill: var(--secondary);
    }

    .mark {
        stroke: var(--primary);
    }

    .badge {
        fill: var(--primary);
        stroke: var(--secondary);
    }

    .glyph {
        stroke: var(--secondary);
    }

    .dot {
        fill: var(--secondary);
        stroke: none;
    }

    .bolt {
        fill: var(--secondary);
    }
</style>
