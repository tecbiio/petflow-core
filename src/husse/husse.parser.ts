import { Cheerio, CheerioAPI, load } from 'cheerio';
import type { Element } from 'domhandler';

export type ScrapedProduct = {
  reference: string;
  articleId?: string;
  name: string;
  priceLabel?: string;
  unitLabel?: string;
  classification?: { global?: string; group?: string };
  imageUrl?: string;
  columns: { key: string; label: string; value?: string }[];
};

export type HusseScrapeResult = {
  products: ScrapedProduct[];
  encounteredLoginPage: boolean;
};

const GROUP_DESCRIPTOR_SELECTOR = 'td.deroule_sous_dossier[id]';
const SECTION_SELECTORS = ['tbody.sous_dossier', "tbody[id^='sous_dossier_']"];
const HEADER_ROW_SELECTOR = 'tr.entete_colonne';
const ROW_SELECTOR = "tr[id^='article_']";
const CELL_SELECTOR = 'td';
const GLOBAL_CLASSIFICATION_SELECTOR = 'h1.ecriture_rouge';
const REFERENCE_LABEL_SELECTOR = '.reference_article label';
const IMAGE_SELECTOR = '.miniature_produit img';
const GENERIC_IMAGE_SELECTOR = 'img[data-id_fichier]';
const CHECKBOX_SELECTOR = "input[type='checkbox']";
const NUMBER_INPUT_SELECTOR = "input[type='number']";
const LABEL_SELECTOR = 'label';
const LOGIN_FORM_SELECTOR = "form[action*='order.husse.fr']";
const LOGIN_EMAIL_SELECTOR = "input[name='co_email']";
const LOGIN_PASSWORD_SELECTOR = "input[name='co_pass']";
const CLASSIFICATION_TARGET_SELECTORS = ['h1', 'h2', 'h3', 'strong', 'span', 'p'];

type ColumnDescriptor = { key: string; label: string; colspan: number };

const normalizeValue = (raw?: string | null): string | undefined => {
  if (!raw) return undefined;
  const cleaned = raw.replace(/\s+/g, ' ').trim();
  return cleaned.length === 0 ? undefined : cleaned;
};

const createColumnKey = (label: string, index: number) => {
  const base = label
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  const slug = base || `colonne-${index + 1}`;
  return `${slug}-${index}`;
};

const detectLoginPage = ($: CheerioAPI) =>
  $(LOGIN_FORM_SELECTOR).length > 0 && $(LOGIN_EMAIL_SELECTOR).length > 0 && $(LOGIN_PASSWORD_SELECTOR).length > 0;

const extractClassificationFromCell = ($: CheerioAPI, cell: Cheerio<Element> | undefined) => {
  if (!cell) return undefined;

  for (const selector of CLASSIFICATION_TARGET_SELECTORS) {
    const target = cell.find(selector).first();
    if (target.length) {
      const value = normalizeValue(target.text());
      if (value) {
        const stripped = value.replace(/^[\-\–\—\•\s]+/, '').trim();
        return normalizeValue(stripped) ?? value;
      }
    }
  }

  const fallback = normalizeValue(cell.text());
  if (!fallback) return undefined;
  const stripped = fallback.replace(/^[\-\–\—\•\s]+/, '').trim();
  return normalizeValue(stripped) ?? fallback;
};

const buildGroupClassificationMap = ($: CheerioAPI) => {
  const map = new Map<string, string | undefined>();

  $(GROUP_DESCRIPTOR_SELECTOR).each((_, el) => {
    const id = $(el).attr('id');
    if (!id) return;
    const suffix = id.replace(/^dossier_/, '');
    if (!suffix) return;
    map.set(suffix, extractClassificationFromCell($, $(el)));
  });

  return map;
};

const buildHeaderDescriptors = (section: Cheerio<Element>): ColumnDescriptor[] => {
  const header = section.find(HEADER_ROW_SELECTOR).first();
  if (header.length === 0) return [];

  return header
    .children()
    .filter((_, el) => ['td', 'th'].includes(el.name ?? ''))
    .map((index, cell) => {
      const rawLabel = header.children().eq(index).text();
      const label = normalizeValue(rawLabel) ?? `Colonne ${index + 1}`;
      const spanAttr = header.children().eq(index).attr('colspan');
      const colspan = spanAttr ? Number(spanAttr) || 1 : 1;
      return { key: createColumnKey(label, index), label, colspan: Math.max(1, colspan) };
    })
    .get();
};

const extractCellValue = ($: CheerioAPI, cell: Cheerio<Element>): string | undefined => {
  const image =
    cell.find(IMAGE_SELECTOR).first().attr('src') ??
    cell.find(GENERIC_IMAGE_SELECTOR).first().attr('src');
  if (image) {
    const value = normalizeValue(image);
    if (value) return value;
  }

  const checkbox = cell.find(CHECKBOX_SELECTOR).first();
  if (checkbox.length) {
    return checkbox.is('[checked]') ? 'Oui' : 'Non';
  }

  const numberInput = cell.find(NUMBER_INPUT_SELECTOR).first();
  if (numberInput.length) {
    const value = normalizeValue(numberInput.attr('value'));
    if (value) return value;
  }

  const label = cell.find(LABEL_SELECTOR).first();
  if (label.length) {
    const value = normalizeValue(label.text());
    if (value) return value;
  }

  return normalizeValue(cell.text());
};

const buildColumns = ($: CheerioAPI, rowCells: Cheerio<Element>[], descriptors: ColumnDescriptor[]) => {
  if (descriptors.length === 0) {
    return rowCells.map((cell, index) => {
      const label = `Colonne ${index + 1}`;
      return { key: createColumnKey(label, index), label, value: extractCellValue($, cell) };
    });
  }

  const columns: { key: string; label: string; value?: string }[] = [];
  let cursor = 0;

  for (const descriptor of descriptors) {
    const span = Math.max(1, descriptor.colspan);
    const parts = rowCells
      .slice(cursor, cursor + span)
      .map((cell) => extractCellValue($, cell))
      .filter((value): value is string => Boolean(value));

    cursor += span;
    const value = parts.length === 0 ? undefined : normalizeValue(parts.join(' '));
    columns.push({ key: descriptor.key, label: descriptor.label, value });
  }

  return columns;
};

const collectProductRows = ($: CheerioAPI, section: Cheerio<Element>): Element[] => {
  let rows = section.find(ROW_SELECTOR).toArray();

  if (rows.length === 0) {
    rows = section
      .find('tr')
      .filter((_, el) => {
        const id = (el.attribs?.id ?? '').toLowerCase();
        return id.startsWith('article_');
      })
      .toArray();
  }

  if (rows.length === 0) {
    rows = section
      .find('tr')
      .filter((_, el) => $(el).find(REFERENCE_LABEL_SELECTOR).length > 0)
      .toArray();
  }

  return rows;
};

const valueFromColumns = (columns: { label: string; value?: string }[], label: string) =>
  columns.find((column) => column.label === label)?.value;

const buildProduct = (
  $: CheerioAPI,
  row: Element,
  descriptors: ColumnDescriptor[],
  classification: { global?: string; group?: string },
): ScrapedProduct | null => {
  const rowCells = $(row).find(CELL_SELECTOR);
  if (rowCells.length === 0) return null;

  const columnCells = rowCells
    .toArray()
    .map((cell) => $(cell as Element));
  const columns = buildColumns($, columnCells, descriptors);

  const articleId =
    $(row)
      .attr('id')
      ?.split('article_')
      .pop() ??
    $(row)
      .find(REFERENCE_LABEL_SELECTOR)
      .first()
      .attr('for')
      ?.split('quantite_')
      .pop();

  const id = normalizeValue($(row).find(REFERENCE_LABEL_SELECTOR).first().text());

  const fallbackId = columnCells[1]
    ? normalizeValue(columnCells[1].find(LABEL_SELECTOR).first().text())
    : undefined;

  const nameCell = columnCells[2];
  const name =
    (nameCell && normalizeValue(nameCell.find(LABEL_SELECTOR).first().text())) ||
    (nameCell && normalizeValue(nameCell.text()));

  const reference = id ?? fallbackId ?? name;
  if (!reference && !name) {
    return null;
  }

  const imageUrl =
    $(row).find(IMAGE_SELECTOR).first().attr('src') ??
    $(row).find(GENERIC_IMAGE_SELECTOR).first().attr('src');

  return {
    reference: reference ?? '',
    articleId: articleId ?? undefined,
    name: name ?? reference ?? '',
    imageUrl: normalizeValue(imageUrl),
    unitLabel: valueFromColumns(columns, 'Unité de commande'),
    priceLabel: valueFromColumns(columns, 'Prix unitaire HT'),
    classification: classification.group || classification.global ? classification : undefined,
    columns,
  };
};

const parseProductsFromHtml = ($: CheerioAPI): HusseScrapeResult => {
  const encounteredLoginPage = detectLoginPage($);
  const groupMap = buildGroupClassificationMap($);
  const globalClassification = normalizeValue($(GLOBAL_CLASSIFICATION_SELECTOR).first().text());
  const products: ScrapedProduct[] = [];

  let sections = SECTION_SELECTORS.flatMap((selector) => $.root().find(selector).toArray().map((el) => $(el)));

  if (sections.length === 0) {
    sections = $(HEADER_ROW_SELECTOR)
      .toArray()
      .map((header) => $(header).parent())
      .filter((parent) => parent.length > 0);
  }

  if (sections.length === 0) {
    sections = $.root().find('tbody').toArray().map((el) => $(el));
  }

  if (sections.length === 0) {
    sections = $.root().find('table').toArray().map((el) => $(el));
  }

  if (sections.length === 0) {
    const root = $($.root().get() as unknown as Element[]);
    sections = [root];
  }

  for (const section of sections) {
    const descriptors = buildHeaderDescriptors(section);
    const id = section.attr('id');
    const suffix = id?.replace(/^sous_dossier_/, '');
    const groupClassification =
      (suffix && groupMap.get(suffix)) ||
      (() => {
        const siblings = section.parent().children().toArray();
        const idx = siblings.findIndex((node) => node === section.get(0));
        for (let i = idx - 1; i >= 0; i -= 1) {
          const sibling = $(siblings[i]);
          if (sibling.is('td') && sibling.is(GROUP_DESCRIPTOR_SELECTOR)) {
            const value = extractClassificationFromCell($, sibling);
            if (value) return value;
          }
          if (sibling.is('tbody') || sibling.is('thead')) {
            const nestedRows = sibling.find('tr').toArray().reverse();
            for (const nested of nestedRows) {
              const cell = $(nested).find(GROUP_DESCRIPTOR_SELECTOR).first();
              if (cell.length) {
                const value = extractClassificationFromCell($, cell);
                if (value) return value;
              }
            }
          }
        }
        return undefined;
      })();

    const classification = { global: globalClassification, group: groupClassification };
    const rows = collectProductRows($, section);

    for (const row of rows) {
      const product = buildProduct($, row, descriptors, classification);
      if (product) {
        products.push(product);
      }
    }
  }

  return { products, encounteredLoginPage };
};

export const parseProductsFromPages = (pages: string[]): HusseScrapeResult => {
  let encounteredLoginPage = false;
  const bucket = new Map<string, ScrapedProduct>();

  for (const html of pages) {
    const $ = load(html);
    const result = parseProductsFromHtml($);
    encounteredLoginPage ||= result.encounteredLoginPage;

    for (const product of result.products) {
      if (!product.reference) continue;
      if (!bucket.has(product.reference)) {
        bucket.set(product.reference, product);
      }
    }
  }

  return { encounteredLoginPage, products: Array.from(bucket.values()) };
};
