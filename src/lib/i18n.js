export const LANGS = ['fi', 'en', 'sv']

const T = {
  fi: {
    // ── Tabs ──────────────────────────────────────────────────────────────────
    tab_filemap:  'Tiedostokartta',
    tab_heatmap:  'Riippuvuuslämpökartta',
    tab_impact:   'Muutosvaikutuskartta',

    // ── Common UI ─────────────────────────────────────────────────────────────
    open:             'Avaa',
    reset:            'Nollaa',
    path_placeholder: 'Liitä projektin absoluuttinen polku…',

    // ── Status messages ───────────────────────────────────────────────────────
    scanning:         'skannataan…',
    parsing_imports:  'parsitaan importteja…',
    nodes_filemap:    '{count} solmua · vieritä zoomataksesi · vedä panoroidaksesi',
    nodes_heatmap:    '{count} solmua · fan-in lämpö · vieritä/vedä',
    nodes_impact:     '{count} solmua · klikkaa tiedostoa tai kansiota',

    // ── FileMap tooltip ───────────────────────────────────────────────────────
    depth:     'syvyys',
    dir_empty: 'kansio (tyhjä)',

    // ── Heatmap / Impact tooltip ──────────────────────────────────────────────
    importers: 'importoijia',
    imports:   'importteja',

    // ── Impact subtitles ──────────────────────────────────────────────────────
    subtitle_filemap: 'Tiedostokartta',
    subtitle_heatmap: 'Riippuvuuslämpökartta',
    subtitle_impact:  'Muutosvaikutuskartta',

    // ── Impact status messages ────────────────────────────────────────────────
    impact_dir_empty: '{name}/ on tyhjä',
    impact_dir_has:   '{name}/ sisältää {count} solmua',
    impact_file_none: '{name} — ei liitoksia',
    impact_file_has:  '{name} → {count} tiedostoa vaikuttuisi',

    // ── Impact legend titles ──────────────────────────────────────────────────
    legend_impact_depth:     'VAIKUTUSSYVYYS',
    legend_folder_contents:  'KANSIOSISÄLTÖ',

    // ── Impact file legend entries ────────────────────────────────────────────
    l_changed_file:    'Muutettu tiedosto',
    l_direct_users:    'Suorat käyttäjät (depth 1)',
    l_depth2:          '2. tason vaikutus',
    l_depth3plus:      '3.+ tason vaikutus',

    // ── Impact dir legend entries ─────────────────────────────────────────────
    l_selected_folder:  'Valittu kansio',
    l_direct_children:  'Suorat lapset',
    l_depth2_content:   '2. tason sisältö',
    l_deeper:           'Syvemmät tasot',

    // ── Shared legend entries ─────────────────────────────────────────────────
    l_not_selected: 'Ei valittu',

    // ── Search ────────────────────────────────────────────────────────────
    search_placeholder: 'Hae tiedostoa tai kansiota…',
  },

  en: {
    // ── Tabs ──────────────────────────────────────────────────────────────────
    tab_filemap: 'File Map',
    tab_heatmap: 'Dependency Heatmap',
    tab_impact:  'Change Impact Map',

    // ── Common UI ─────────────────────────────────────────────────────────────
    open:             'Open',
    reset:            'Reset',
    path_placeholder: 'Paste absolute project path…',

    // ── Status messages ───────────────────────────────────────────────────────
    scanning:        'scanning…',
    parsing_imports: 'parsing imports…',
    nodes_filemap:   '{count} nodes · scroll to zoom · drag to pan',
    nodes_heatmap:   '{count} nodes · fan-in heat · scroll/drag',
    nodes_impact:    '{count} nodes · click a file or folder',

    // ── FileMap tooltip ───────────────────────────────────────────────────────
    depth:     'depth',
    dir_empty: 'dir (empty)',

    // ── Heatmap / Impact tooltip ──────────────────────────────────────────────
    importers: 'importers',
    imports:   'imports',

    // ── Impact subtitles ──────────────────────────────────────────────────────
    subtitle_filemap: 'File Map',
    subtitle_heatmap: 'Dependency Heatmap',
    subtitle_impact:  'Change Impact Map',

    // ── Impact status messages ────────────────────────────────────────────────
    impact_dir_empty: '{name}/ is empty',
    impact_dir_has:   '{name}/ contains {count} nodes',
    impact_file_none: '{name} — no connections',
    impact_file_has:  '{name} → {count} files affected',

    // ── Impact legend titles ──────────────────────────────────────────────────
    legend_impact_depth:    'IMPACT DEPTH',
    legend_folder_contents: 'FOLDER CONTENTS',

    // ── Impact file legend entries ────────────────────────────────────────────
    l_changed_file:  'Changed file',
    l_direct_users:  'Direct users (depth 1)',
    l_depth2:        'Depth 2 impact',
    l_depth3plus:    'Depth 3+ impact',

    // ── Impact dir legend entries ─────────────────────────────────────────────
    l_selected_folder:  'Selected folder',
    l_direct_children:  'Direct children',
    l_depth2_content:   'Depth 2 content',
    l_deeper:           'Deeper levels',

    // ── Shared legend entries ─────────────────────────────────────────────────
    l_not_selected: 'Not selected',

    // ── Search ────────────────────────────────────────────────────────────
    search_placeholder: 'Search file or folder…',
  },

  sv: {
    // ── Tabs ──────────────────────────────────────────────────────────────────
    tab_filemap: 'Filkarta',
    tab_heatmap: 'Beroendekarta',
    tab_impact:  'Ändringspåverkanskarta',

    // ── Common UI ─────────────────────────────────────────────────────────────
    open:             'Öppna',
    reset:            'Återställ',
    path_placeholder: 'Klistra in absolut projektsökväg…',

    // ── Status messages ───────────────────────────────────────────────────────
    scanning:        'söker igenom…',
    parsing_imports: 'analyserar importer…',
    nodes_filemap:   '{count} noder · scrolla för zoom · dra för att panorera',
    nodes_heatmap:   '{count} noder · fan-in värme · scrolla/dra',
    nodes_impact:    '{count} noder · klicka på en fil eller mapp',

    // ── FileMap tooltip ───────────────────────────────────────────────────────
    depth:     'djup',
    dir_empty: 'mapp (tom)',

    // ── Heatmap / Impact tooltip ──────────────────────────────────────────────
    importers: 'importörer',
    imports:   'importer',

    // ── Impact subtitles ──────────────────────────────────────────────────────
    subtitle_filemap: 'Filkarta',
    subtitle_heatmap: 'Beroendekarta',
    subtitle_impact:  'Ändringspåverkanskarta',

    // ── Impact status messages ────────────────────────────────────────────────
    impact_dir_empty: '{name}/ är tom',
    impact_dir_has:   '{name}/ innehåller {count} noder',
    impact_file_none: '{name} — inga kopplingar',
    impact_file_has:  '{name} → {count} filer påverkas',

    // ── Impact legend titles ──────────────────────────────────────────────────
    legend_impact_depth:    'PÅVERKANSDJUP',
    legend_folder_contents: 'MAPPINNEHÅLL',

    // ── Impact file legend entries ────────────────────────────────────────────
    l_changed_file:  'Ändrad fil',
    l_direct_users:  'Direkta användare (djup 1)',
    l_depth2:        'Djup 2 påverkan',
    l_depth3plus:    'Djup 3+ påverkan',

    // ── Impact dir legend entries ─────────────────────────────────────────────
    l_selected_folder:  'Vald mapp',
    l_direct_children:  'Direkta barn',
    l_depth2_content:   'Djup 2 innehåll',
    l_deeper:           'Djupare nivåer',

    // ── Shared legend entries ─────────────────────────────────────────────────
    l_not_selected: 'Ej vald',

    // ── Search ────────────────────────────────────────────────────────────
    search_placeholder: 'Sök fil eller mapp…',
  },
}

/** Return the translation for `key` in `lang`, falling back to Finnish, then the key itself. */
export function t(key, lang = 'fi') {
  return T[lang]?.[key] ?? T.fi[key] ?? key
}

/** Like t(), but interpolates `{var}` placeholders from `vars`.
 *  e.g. tf('impact_dir_has', { name: 'src', count: 5 }, lang) */
export function tf(key, vars, lang = 'fi') {
  return t(key, lang).replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? '')
}
