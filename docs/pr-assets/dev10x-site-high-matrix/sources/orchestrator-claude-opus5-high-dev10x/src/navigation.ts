export type NavItem = {
  /** Stable section id the link points at. */
  readonly id: string;
  /** Visible link label. */
  readonly label: string;
};

/** Single source of truth shared by the header nav and the footer sitemap. */
export const NAV_ITEMS: readonly NavItem[] = [
  { id: "visao", label: "Visão" },
  { id: "fluxo", label: "Fluxo" },
  { id: "agentes", label: "Agentes" },
  { id: "evidencias", label: "Evidências" },
];
