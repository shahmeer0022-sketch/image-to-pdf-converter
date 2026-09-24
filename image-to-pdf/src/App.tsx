import { type ReactNode, useEffect, useRef, useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';
import {
  ArrowDown,
  ArrowUp,
  Check,
  ChevronDown,
  Download,
  FileImage,
  FileOutput,
  GripVertical,
  ImagePlus,
  LockKeyhole,
  Plus,
  RotateCcw,
  ShieldCheck,
  Sparkles,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { Route, Switch, useLocation, Router as WouterRouter } from 'wouter';

type PageSize = 'a4' | 'letter' | 'fit' | 'passport';
type PassportPhotoSize = '35x45' | '35x35' | '40x60' | '2x2';
type PassportCopies = 4 | 6 | 8 | 10 | 12;
type ImageItem = { id: string; file: File; url: string; width: number; height: number };
type PdfImage = { bytes: Uint8Array; width: number; height: number };
type PdfPlacement = { x: number; y: number; width: number; height: number };
type PdfPage = { width: number; height: number; image: PdfImage; placements: PdfPlacement[]; cropToBox?: boolean };
const acceptedMimeTypes = new Set(['image/jpeg', 'image/png', 'image/webp']);
const acceptedExtensions = new Set(['jpg', 'jpeg', 'png', 'webp']);

const queryClient = new QueryClient();
const pageSizes: Record<Exclude<PageSize, 'fit' | 'passport'>, [number, number]> = {
  a4: [595.28, 841.89],
  letter: [612, 792],
};
const passportPhotoSizes: Record<PassportPhotoSize, [number, number]> = {
  '35x45': [35 * 72 / 25.4, 45 * 72 / 25.4],
  '35x35': [35 * 72 / 25.4, 35 * 72 / 25.4],
  '40x60': [40 * 72 / 25.4, 60 * 72 / 25.4],
  '2x2': [2 * 72, 2 * 72],
};
const passportPhotoLabels: Record<PassportPhotoSize, string> = {
  '35x45': '35 × 45 mm',
  '35x35': '35 × 35 mm',
  '40x60': '40 × 60 mm',
  '2x2': '2 × 2 in · 50.8 × 50.8 mm',
};
const passportCopyOptions: PassportCopies[] = [4, 6, 8, 10, 12];

function formatBytes(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function formatName(name: string) {
  return name.length > 24 ? `${name.slice(0, 19)}…${name.slice(name.lastIndexOf('.'))}` : name;
}

function isSupportedImage(file: File) {
  const extension = file.name.split('.').pop()?.toLowerCase() ?? '';
  return acceptedMimeTypes.has(file.type) || acceptedExtensions.has(extension);
}

async function loadImage(file: File, url: string): Promise<ImageItem> {
  const image = new Image();
  image.src = url;
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error(`Could not read ${file.name}`));
  });
  if (!image.naturalWidth || !image.naturalHeight) {
    throw new Error(`Could not read ${file.name}`);
  }
  return { id: `${file.name}-${file.lastModified}-${Math.random()}`, file, url, width: image.naturalWidth, height: image.naturalHeight };
}

async function toPdfImage(item: ImageItem): Promise<PdfImage> {
  const image = new Image();
  image.src = item.url;
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error(`Could not process ${item.file.name}`));
  });
  const canvas = document.createElement('canvas');
  canvas.width = item.width;
  canvas.height = item.height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Your browser could not prepare the image.');
  context.fillStyle = '#fff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, 0, 0);
  const base64 = canvas.toDataURL('image/jpeg', 0.94).split(',')[1];
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return { bytes, width: item.width, height: item.height };
}

function containPlacement(image: PdfImage, box: PdfPlacement): PdfPlacement {
  const scale = Math.min(box.width / image.width, box.height / image.height);
  const width = image.width * scale;
  const height = image.height * scale;
  return {
    x: box.x + (box.width - width) / 2,
    y: box.y + (box.height - height) / 2,
    width,
    height,
  };
}

function passportLayout(photoSize: PassportPhotoSize, copies: number) {
  const [pageWidth, pageHeight] = pageSizes.a4;
  const [photoWidth, photoHeight] = passportPhotoSizes[photoSize];
  const margin = 36;
  const gap = 16;
  const preferredColumns = photoHeight >= photoWidth ? 2 : 3;
  return Array.from({ length: copies }, (_, index) => index + 1)
    .map((columns) => {
      const rows = Math.ceil(copies / columns);
      const width = columns * photoWidth + (columns - 1) * gap;
      const height = rows * photoHeight + (rows - 1) * gap;
      return { columns, rows, width, height, unusedSlots: columns * rows - copies };
    })
    .filter((candidate) => candidate.width <= pageWidth - margin * 2 && candidate.height <= pageHeight - margin * 2)
    .sort((first, second) =>
      first.unusedSlots - second.unusedSlots
      || Math.abs(first.columns - preferredColumns) - Math.abs(second.columns - preferredColumns)
      || first.width * first.height - second.width * second.height,
    )[0] ?? null;
}

function passportPlacements(photoSize: PassportPhotoSize, copies: PassportCopies): PdfPlacement[][] {
  const [pageWidth, pageHeight] = pageSizes.a4;
  const [photoWidth, photoHeight] = passportPhotoSizes[photoSize];
  const gap = 16;
  const pages: PdfPlacement[][] = [];
  let remaining = copies;

  while (remaining > 0) {
    let pageCopies = remaining;
    let layout = passportLayout(photoSize, pageCopies);
    while (!layout && pageCopies > 0) {
      pageCopies -= 1;
      layout = passportLayout(photoSize, pageCopies);
    }
    if (!layout) throw new Error('These passport photos do not fit on an A4 sheet.');

    const startX = (pageWidth - layout.width) / 2;
    const startY = (pageHeight - layout.height) / 2;
    pages.push(Array.from({ length: pageCopies }, (_, index) => {
      const column = index % layout.columns;
      const row = Math.floor(index / layout.columns);
      return {
        x: startX + column * (photoWidth + gap),
        y: startY + row * (photoHeight + gap),
        width: photoWidth,
        height: photoHeight,
      };
    }));
    remaining -= pageCopies;
  }

  return pages;
}

function pdfPages(images: PdfImage[], pageSize: PageSize, photoSize: PassportPhotoSize, copies: PassportCopies): PdfPage[] {
  if (pageSize === 'passport') {
    const [width, height] = pageSizes.a4;
    return images.flatMap((image) => passportPlacements(photoSize, copies).map((placements) => ({
      width,
      height,
      image,
      placements,
      cropToBox: true,
    })));
  }

  return images.map((image) => {
    const [width, height] = pageSize === 'fit'
      ? [image.width + 48, image.height + 48]
      : pageSizes[pageSize];
    return {
      width,
      height,
      image,
      placements: [containPlacement(image, { x: 24, y: 24, width: width - 48, height: height - 48 })],
    };
  });
}

function imagePlacementStream(image: PdfImage, placement: PdfPlacement, cropToBox: boolean) {
  if (!cropToBox) {
    return `q\n${placement.width.toFixed(3)} 0 0 ${placement.height.toFixed(3)} ${placement.x.toFixed(3)} ${placement.y.toFixed(3)} cm\n/Im0 Do\nQ\n`;
  }

  const scale = Math.max(placement.width / image.width, placement.height / image.height);
  const drawWidth = image.width * scale;
  const drawHeight = image.height * scale;
  const drawX = placement.x + (placement.width - drawWidth) / 2;
  const drawY = placement.y + (placement.height - drawHeight) / 2;
  return `q\n${placement.x.toFixed(3)} ${placement.y.toFixed(3)} ${placement.width.toFixed(3)} ${placement.height.toFixed(3)} re W n\n${drawWidth.toFixed(3)} 0 0 ${drawHeight.toFixed(3)} ${drawX.toFixed(3)} ${drawY.toFixed(3)} cm\n/Im0 Do\nQ\n`;
}

function makePdf(images: PdfImage[], pageSize: PageSize, photoSize: PassportPhotoSize, copies: PassportCopies) {
  const pages = pdfPages(images, pageSize, photoSize, copies);
  const encoder = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const offsets: number[] = [0];
  let length = 0;
  const pushText = (text: string) => {
    const bytes = encoder.encode(text);
    chunks.push(bytes);
    length += bytes.length;
  };
  const pushBytes = (bytes: Uint8Array) => { chunks.push(bytes); length += bytes.length; };
  pushText('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');
  const pageRefs: number[] = [];
  const objectTotal = 2 + pages.length * 3;
  let nextObject = 3;
  pages.forEach(() => {
    pageRefs.push(nextObject);
    nextObject += 3;
  });
  offsets[1] = length;
  pushText('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');
  offsets[2] = length;
  pushText(`2 0 obj\n<< /Type /Pages /Kids [${pageRefs.map((ref) => `${ref} 0 R`).join(' ')}] /Count ${pages.length} >>\nendobj\n`);
  pages.forEach((page, index) => {
    const pageObject = pageRefs[index];
    const imageObject = pageObject + 1;
    const contentObject = pageObject + 2;
    const stream = page.placements.map((placement) => imagePlacementStream(page.image, placement, Boolean(page.cropToBox))).join('');
    offsets[pageObject] = length;
    pushText(`${pageObject} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${page.width.toFixed(3)} ${page.height.toFixed(3)}] /Resources << /XObject << /Im0 ${imageObject} 0 R >> >> /Contents ${contentObject} 0 R >>\nendobj\n`);
    offsets[imageObject] = length;
    pushText(`${imageObject} 0 obj\n<< /Type /XObject /Subtype /Image /Width ${page.image.width} /Height ${page.image.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${page.image.bytes.length} >>\nstream\n`);
    pushBytes(page.image.bytes);
    pushText('\nendstream\nendobj\n');
    offsets[contentObject] = length;
    pushText(`${contentObject} 0 obj\n<< /Length ${encoder.encode(stream).length} >>\nstream\n${stream}endstream\nendobj\n`);
  });
  const xref = length;
  pushText(`xref\n0 ${objectTotal + 1}\n0000000000 65535 f \n`);
  for (let index = 1; index <= objectTotal; index += 1) pushText(`${String(offsets[index] ?? 0).padStart(10, '0')} 00000 n \n`);
  pushText(`trailer\n<< /Size ${objectTotal + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`);
  const output = new Uint8Array(length);
  let cursor = 0;
  chunks.forEach((chunk) => { output.set(chunk, cursor); cursor += chunk.length; });
  return new Blob([output], { type: 'application/pdf' });
}

function Logo() {
  return (
    <div className="flex items-center gap-3" data-testid="brand-logo">
      <div className="relative flex h-10 w-10 items-center justify-center rounded-xl bg-[hsl(var(--primary))] text-[hsl(var(--background))] shadow-[4px_4px_0_hsl(var(--accent))]">
        <FileOutput size={20} strokeWidth={2.4} />
        <span className="absolute bottom-1 right-1 h-1.5 w-1.5 rounded-full bg-[hsl(var(--accent))]" />
      </div>
      <div>
        <p className="font-serif text-[1.17rem] font-bold leading-none tracking-[-.025em]">Paper<span className="text-[hsl(var(--accent))]">cut</span></p>
        <p className="mt-1 text-[10px] font-semibold uppercase tracking-[.2em] text-[hsl(var(--muted-foreground))]">image to pdf</p>
      </div>
    </div>
  );
}

function EmptyState({ onChoose, onDropFiles }: { onChoose: () => void; onDropFiles: (files: FileList) => void }) {
  const [dragging, setDragging] = useState(false);
  return (
    <div
      className={`group relative flex min-h-[360px] flex-col items-center justify-center overflow-hidden rounded-[1.5rem] border-2 border-dashed border-[hsl(var(--border))] bg-[hsl(var(--card))] px-6 py-12 text-center transition-all duration-300 ${dragging ? 'drop-active' : 'hover:border-[hsl(var(--accent)/.55)]'}`}
      onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={(event) => { event.preventDefault(); setDragging(false); onDropFiles(event.dataTransfer.files); }}
      data-testid="dropzone-empty"
    >
      <div className="pointer-events-none absolute -right-8 -top-10 h-36 w-36 rounded-full border-[18px] border-[hsl(var(--accent)/.1)]" />
      <div className="pointer-events-none absolute -bottom-12 -left-10 h-32 w-32 rounded-full border-[14px] border-[hsl(var(--primary)/.06)]" />
      <p className="relative mb-4 text-[11px] font-bold uppercase tracking-[.18em] text-[hsl(var(--accent))]">1 · Choose photos</p>
      <div className="relative mb-7 flex h-20 w-20 items-center justify-center rounded-[1.4rem] bg-[hsl(var(--secondary))] text-[hsl(var(--accent))] shadow-[0_8px_20px_hsl(var(--primary)/.08)] transition-transform duration-300 group-hover:-translate-y-1">
        <Upload size={29} strokeWidth={1.7} />
        <span className="absolute -right-1 -top-1 flex h-7 w-7 items-center justify-center rounded-full bg-[hsl(var(--accent))] text-[hsl(var(--accent-foreground))] shadow-sm"><Plus size={16} /></span>
      </div>
      <h2 className="relative font-serif text-2xl font-bold tracking-[-.025em] text-[hsl(var(--foreground))]">{dragging ? 'Release to add photos' : 'Choose your photos'}</h2>
      <p className="relative mt-2 max-w-sm text-sm leading-6 text-[hsl(var(--muted-foreground))]">Select one or more images at once, or drop them here. Your files never leave this browser.</p>
      <button type="button" onClick={onChoose} className="relative mt-7 inline-flex items-center gap-2 rounded-xl bg-[hsl(var(--primary))] px-5 py-3 text-sm font-semibold text-[hsl(var(--primary-foreground))] shadow-[0_5px_0_hsl(var(--accent))] transition-all hover:-translate-y-0.5 hover:shadow-[0_7px_0_hsl(var(--accent))] active:translate-y-0 active:shadow-[0_2px_0_hsl(var(--accent))]" data-testid="button-choose-images">
        <ImagePlus size={17} /> Choose photos
      </button>
      <p className="relative mt-5 text-[11px] font-semibold uppercase tracking-[.14em] text-[hsl(var(--muted-foreground))]">JPG · PNG · WEBP <span className="mx-1 text-[hsl(var(--border))]">·</span> multiple files supported</p>
    </div>
  );
}

function ImageCard({ item, index, total, onRemove, onMove, onDragStart, onDragOver, onDragEnd }: {
  item: ImageItem; index: number; total: number; onRemove: () => void; onMove: (direction: 'up' | 'down') => void; onDragStart: () => void; onDragOver: () => void; onDragEnd: () => void;
}) {
  return (
    <article draggable onDragStart={onDragStart} onDragEnd={onDragEnd} onDragOver={(event) => { event.preventDefault(); onDragOver(); }} className="group relative flex items-center gap-3 rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-2.5 transition-all duration-200 hover:-translate-y-0.5 hover:border-[hsl(var(--accent)/.45)] hover:shadow-[0_8px_22px_hsl(var(--primary)/.08)]" data-testid={`card-image-${item.id}`}>
      <div className="flex shrink-0 cursor-grab items-center text-[hsl(var(--muted-foreground)/.55)] active:cursor-grabbing" aria-label={`Drag page ${index + 1} to reorder`} title="Drag to reorder"><GripVertical size={18} /></div>
      <div className="relative h-[4.5rem] w-[4.5rem] shrink-0 overflow-hidden rounded-xl bg-[hsl(var(--secondary))]">
        <img src={item.url} alt={item.file.name} className="h-full w-full object-cover" data-testid={`img-preview-${item.id}`} />
        <span className="absolute bottom-1 left-1 rounded-md bg-[hsl(var(--primary)/.86)] px-1.5 py-0.5 text-[9px] font-bold text-[hsl(var(--primary-foreground))]">Page {index + 1}</span>
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-[hsl(var(--foreground))]" title={item.file.name}>{formatName(item.file.name)}</p>
        <p className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">{item.width} × {item.height} · {formatBytes(item.file.size)}</p>
      </div>
      <div className="flex items-center gap-0.5">
        <button type="button" disabled={index === 0} onClick={() => onMove('up')} className="rounded-lg p-2 text-[hsl(var(--muted-foreground))] transition-colors hover:bg-[hsl(var(--secondary))] hover:text-[hsl(var(--foreground))] disabled:cursor-not-allowed disabled:opacity-25" aria-label={`Move ${item.file.name} up`} title="Move up" data-testid={`button-move-up-${item.id}`}><ArrowUp size={15} /></button>
        <button type="button" disabled={index === total - 1} onClick={() => onMove('down')} className="rounded-lg p-2 text-[hsl(var(--muted-foreground))] transition-colors hover:bg-[hsl(var(--secondary))] hover:text-[hsl(var(--foreground))] disabled:cursor-not-allowed disabled:opacity-25" aria-label={`Move ${item.file.name} down`} title="Move down" data-testid={`button-move-down-${item.id}`}><ArrowDown size={15} /></button>
        <button type="button" onClick={onRemove} className="rounded-lg p-2 text-[hsl(var(--muted-foreground))] transition-colors hover:bg-[hsl(var(--destructive)/.1)] hover:text-[hsl(var(--destructive))]" aria-label={`Remove ${item.file.name}`} title="Remove image" data-testid={`button-remove-${item.id}`}><X size={16} /></button>
      </div>
    </article>
  );
}

function PageSizePicker({
  value,
  onChange,
  photoSize,
  onPhotoSizeChange,
  copies,
  onCopiesChange,
}: {
  value: PageSize;
  onChange: (value: PageSize) => void;
  photoSize: PassportPhotoSize;
  onPhotoSizeChange: (value: PassportPhotoSize) => void;
  copies: PassportCopies;
  onCopiesChange: (value: PassportCopies) => void;
}) {
  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <label htmlFor="page-size" className="text-sm font-bold">Page size</label>
        <span className="text-[11px] font-semibold uppercase tracking-[.12em] text-[hsl(var(--muted-foreground))]">PDF format</span>
      </div>
      <div className="relative">
        <select id="page-size" value={value} onChange={(event) => onChange(event.target.value as PageSize)} className="w-full appearance-none rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-4 py-3 text-sm font-semibold outline-none transition-colors focus:border-[hsl(var(--accent))] focus:ring-2 focus:ring-[hsl(var(--accent)/.16)]" data-testid="select-page-size">
          <option value="a4">A4 · 210 × 297 mm</option>
          <option value="letter">US Letter · 8.5 × 11 in</option>
          <option value="fit">Fit to image · no crop</option>
          <option value="passport">Passport Photo · A4 sheet</option>
        </select>
        <ChevronDown className="pointer-events-none absolute right-4 top-3.5 text-[hsl(var(--muted-foreground))]" size={17} />
      </div>
      {value === 'passport' && (
        <div className="mt-4 space-y-3 rounded-xl bg-[hsl(var(--secondary)/.58)] p-3">
          <div>
            <label htmlFor="passport-photo-size" className="mb-1.5 block text-xs font-bold">Photo size</label>
            <div className="relative">
              <select id="passport-photo-size" value={photoSize} onChange={(event) => onPhotoSizeChange(event.target.value as PassportPhotoSize)} className="w-full appearance-none rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-3 py-2.5 pr-9 text-xs font-semibold outline-none transition-colors focus:border-[hsl(var(--accent))] focus:ring-2 focus:ring-[hsl(var(--accent)/.16)]" data-testid="select-passport-photo-size">
                {(Object.keys(passportPhotoLabels) as PassportPhotoSize[]).map((size) => <option key={size} value={size}>{passportPhotoLabels[size]}</option>)}
              </select>
              <ChevronDown className="pointer-events-none absolute right-3 top-3 text-[hsl(var(--muted-foreground))]" size={15} />
            </div>
          </div>
          <div>
            <label htmlFor="passport-copies" className="mb-1.5 block text-xs font-bold">Copies per A4 sheet</label>
            <div className="relative">
              <select id="passport-copies" value={copies} onChange={(event) => onCopiesChange(Number(event.target.value) as PassportCopies)} className="w-full appearance-none rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-3 py-2.5 pr-9 text-xs font-semibold outline-none transition-colors focus:border-[hsl(var(--accent))] focus:ring-2 focus:ring-[hsl(var(--accent)/.16)]" data-testid="select-passport-copies">
                {passportCopyOptions.map((option) => <option key={option} value={option}>{option} copies</option>)}
              </select>
              <ChevronDown className="pointer-events-none absolute right-3 top-3 text-[hsl(var(--muted-foreground))]" size={15} />
            </div>
          </div>
          <p className="text-[11px] leading-4 text-[hsl(var(--muted-foreground))]">Each photo keeps its exact printed size, stays centered, and is cropped proportionally only when needed to fill the selected ratio.</p>
        </div>
      )}
    </div>
  );
}

function Home() {
  const [items, setItems] = useState<ImageItem[]>([]);
  const [pageSize, setPageSize] = useState<PageSize>('a4');
  const [passportPhotoSize, setPassportPhotoSize] = useState<PassportPhotoSize>('35x45');
  const [passportCopies, setPassportCopies] = useState<PassportCopies>(6);
  const [isDragging, setIsDragging] = useState(false);
  const [isBuilding, setIsBuilding] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const itemsRef = useRef<ImageItem[]>([]);

  itemsRef.current = items;
  useEffect(() => () => { itemsRef.current.forEach((item) => URL.revokeObjectURL(item.url)); }, []);

  const addFiles = async (files: FileList | File[]) => {
    const selected = Array.from(files);
    const accepted = selected.filter(isSupportedImage);
    const skippedNames = selected.filter((file) => !isSupportedImage(file)).map((file) => file.name);
    if (!accepted.length) {
      setFeedback({ type: 'error', message: 'Please choose JPG, PNG, or WEBP images.' });
      return;
    }
    const results = await Promise.allSettled(accepted.map((file) => {
      const url = URL.createObjectURL(file);
      return loadImage(file, url).catch((error) => { URL.revokeObjectURL(url); throw error; });
    }));
    const loaded = results.flatMap((result) => result.status === 'fulfilled' ? [result.value] : []);
    const failedNames = results.flatMap((result, index) => result.status === 'rejected' ? [accepted[index].name] : []);
    if (loaded.length) setItems((current) => [...current, ...loaded]);
    const problemNames = [...skippedNames, ...failedNames];
    if (problemNames.length) {
      const shownNames = problemNames.slice(0, 2).join(', ');
      const suffix = problemNames.length > 2 ? ` and ${problemNames.length - 2} more` : '';
      setFeedback({
        type: 'error',
        message: loaded.length
          ? `Added ${loaded.length} image${loaded.length === 1 ? '' : 's'}. Skipped ${shownNames}${suffix}.`
          : `Could not add ${shownNames}${suffix}. Please choose JPG, PNG, or WEBP images.`,
      });
    } else {
      setFeedback(null);
    }
  };

  const removeItem = (id: string) => {
    setItems((current) => {
      const removed = current.find((item) => item.id === id);
      if (removed) URL.revokeObjectURL(removed.url);
      return current.filter((item) => item.id !== id);
    });
    setFeedback(null);
  };

  const moveItem = (index: number, direction: 'up' | 'down') => {
    const target = direction === 'up' ? index - 1 : index + 1;
    if (target < 0 || target >= items.length) return;
    setItems((current) => {
      const next = [...current];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  };

  const reorderTo = (targetIndex: number) => {
    if (dragIndex === null || dragIndex === targetIndex) return;
    setItems((current) => {
      const next = [...current];
      const [moved] = next.splice(dragIndex, 1);
      if (moved) next.splice(targetIndex, 0, moved);
      return next;
    });
    setDragIndex(null);
  };

  const createPdf = async () => {
    if (!items.length || isBuilding) return;
    setIsBuilding(true);
    setFeedback(null);
    try {
      const pdfImages = await Promise.all(items.map(toPdfImage));
      const blob = makePdf(pdfImages, pageSize, passportPhotoSize, passportCopies);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `papercut-${new Date().toISOString().slice(0, 10)}.pdf`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      const resultLabel = pageSize === 'passport'
        ? `${items.length} ${items.length === 1 ? 'A4 sheet' : 'A4 sheets'}`
        : `${items.length} ${items.length === 1 ? 'page' : 'pages'}`;
      setFeedback({ type: 'success', message: `PDF ready · ${resultLabel}` });
    } catch (error) {
      setFeedback({ type: 'error', message: error instanceof Error ? error.message : 'The PDF could not be created. Please try again.' });
    } finally {
      setIsBuilding(false);
    }
  };

  return (
    <main className="paper-grain min-h-[100dvh] bg-[hsl(var(--background))]">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-5 py-6 sm:px-8 lg:px-10">
        <Logo />
        <div className="hidden items-center gap-2 text-xs font-semibold text-[hsl(var(--muted-foreground))] sm:flex"><LockKeyhole size={14} className="text-[hsl(var(--accent))]" /> Local by design</div>
      </header>
      <div className="mx-auto max-w-6xl px-5 pb-14 pt-8 sm:px-8 sm:pt-12 lg:px-10 lg:pb-20">
        <section className="rise-in mb-10 max-w-2xl">
          <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-[hsl(var(--accent)/.22)] bg-[hsl(var(--accent)/.08)] px-3 py-1.5 text-[11px] font-bold uppercase tracking-[.16em] text-[hsl(var(--accent))]"><Sparkles size={13} /> A quieter way to make a PDF</div>
          <h1 className="font-serif text-[clamp(2.7rem,7vw,5.1rem)] font-bold leading-[.94] tracking-[-.055em] text-[hsl(var(--foreground))]">Gather. Arrange.<br /><span className="text-[hsl(var(--accent))]">Make it a document.</span></h1>
          <p className="mt-5 max-w-lg text-base leading-7 text-[hsl(var(--muted-foreground))]">Turn a handful of images into a polished PDF in seconds. No upload, no account, no mystery.</p>
        </section>

        <section className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_310px] lg:items-start">
          <div className="rise-in rise-in-delay-1 min-w-0">
            {items.length === 0 ? (
              <EmptyState onChoose={() => inputRef.current?.click()} onDropFiles={(files) => void addFiles(files)} />
            ) : (
              <div
                className={`rounded-[1.5rem] border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-4 transition-colors sm:p-6 ${isDragging ? 'drop-active' : ''}`}
                onDragOver={(event) => { if (!event.dataTransfer.types.includes('Files')) return; event.preventDefault(); setIsDragging(true); }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={(event) => { if (!event.dataTransfer.types.includes('Files')) return; event.preventDefault(); setIsDragging(false); void addFiles(event.dataTransfer.files); }}
                data-testid="dropzone-populated"
              >
                <div className="mb-5 flex items-start justify-between gap-4">
                  <div>
                    <p className="text-[11px] font-bold uppercase tracking-[.16em] text-[hsl(var(--accent))]">2 · Arrange your pages</p>
                    <h2 className="mt-1 font-serif text-2xl font-bold tracking-[-.025em]">Your PDF pages</h2>
                    <p className="mt-1 max-w-md text-sm leading-5 text-[hsl(var(--muted-foreground))]">Each thumbnail becomes one page, in the order shown.</p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-2">
                    <span className="rounded-full bg-[hsl(var(--secondary))] px-2.5 py-1 text-[11px] font-bold text-[hsl(var(--muted-foreground))]">{items.length} {items.length === 1 ? 'page' : 'pages'}</span>
                    <button type="button" onClick={() => inputRef.current?.click()} className="inline-flex items-center gap-1.5 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-3 py-2 text-xs font-bold transition-colors hover:border-[hsl(var(--accent)/.5)] hover:text-[hsl(var(--accent))]" data-testid="button-add-more"><Plus size={15} /> Add photos</button>
                  </div>
                </div>
                <div className="space-y-2.5">
                  {items.map((item, index) => <ImageCard key={item.id} item={item} index={index} total={items.length} onRemove={() => removeItem(item.id)} onMove={(direction) => moveItem(index, direction)} onDragStart={() => setDragIndex(index)} onDragOver={() => reorderTo(index)} onDragEnd={() => setDragIndex(null)} />)}
                </div>
                <div className={`mt-5 flex items-center gap-2 rounded-xl px-3 py-2.5 text-xs transition-colors ${isDragging ? 'bg-[hsl(var(--accent)/.12)] font-semibold text-[hsl(var(--accent))]' : 'bg-[hsl(var(--secondary)/.58)] text-[hsl(var(--muted-foreground))]'}`} aria-live="polite">
                  <GripVertical size={14} /> {isDragging ? 'Drop images here to add them to the end.' : 'Drag a page by its handle to reorder. The numbers show PDF order.'}
                </div>
              </div>
            )}
            <input ref={inputRef} type="file" accept="image/jpeg,image/png,image/webp" multiple className="hidden" onChange={(event) => { if (event.target.files) void addFiles(event.target.files); event.target.value = ''; }} data-testid="input-image-files" />
          </div>

          <aside className="rise-in rise-in-delay-2 rounded-[1.5rem] border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-5 shadow-[0_10px_30px_hsl(var(--primary)/.055)] lg:sticky lg:top-6 sm:p-6">
            <div className="mb-6 flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[hsl(var(--secondary))] text-[hsl(var(--primary))]"><FileImage size={19} /></div>
              <div><p className="text-[10px] font-bold uppercase tracking-[.16em] text-[hsl(var(--accent))]">3 · Export</p><h2 className="mt-0.5 font-serif text-lg font-bold">Export settings</h2><p className="text-xs text-[hsl(var(--muted-foreground))]">Set the page size, then download.</p></div>
            </div>
            <PageSizePicker
              value={pageSize}
              onChange={setPageSize}
              photoSize={passportPhotoSize}
              onPhotoSizeChange={setPassportPhotoSize}
              copies={passportCopies}
              onCopiesChange={setPassportCopies}
            />
            <div className="my-6 h-px bg-[hsl(var(--border))]" />
            <div className="space-y-3 text-xs text-[hsl(var(--muted-foreground))]">
              <div className="flex items-start gap-2.5"><ShieldCheck size={16} className="mt-0.5 shrink-0 text-[hsl(var(--accent))]" /><span>Images are processed locally in your browser.</span></div>
              <div className="flex items-start gap-2.5"><Check size={16} className="mt-0.5 shrink-0 text-[hsl(var(--accent))]" /><span>Each image becomes one crisp PDF page.</span></div>
            </div>
            {!items.length && <p className="mt-6 rounded-xl bg-[hsl(var(--secondary)/.58)] px-3 py-2.5 text-xs leading-5 text-[hsl(var(--muted-foreground))]">Add at least one photo to enable the PDF download.</p>}
            {isBuilding && <div className="mt-6 rounded-xl border border-[hsl(var(--accent)/.2)] bg-[hsl(var(--accent)/.07)] p-3" role="status" data-testid="status-building">
              <div className="flex items-center gap-2 text-xs font-bold text-[hsl(var(--accent))]"><RotateCcw size={14} className="animate-spin" /> Creating your PDF</div>
              <p className="mt-1.5 text-xs leading-5 text-[hsl(var(--muted-foreground))]">Combining {items.length} {items.length === 1 ? 'page' : 'pages'} locally in your browser.</p>
              <div className="mt-3 h-1 overflow-hidden rounded-full bg-[hsl(var(--accent)/.14)]"><div className="progress-bar h-full w-1/2 rounded-full bg-[hsl(var(--accent))]" /></div>
            </div>}
            <button type="button" disabled={!items.length || isBuilding} onClick={() => void createPdf()} className="mt-7 flex w-full items-center justify-center gap-2 rounded-xl bg-[hsl(var(--accent))] px-4 py-3.5 text-sm font-bold text-[hsl(var(--accent-foreground))] shadow-[0_5px_0_hsl(17_70%_40%)] transition-all hover:-translate-y-0.5 hover:shadow-[0_7px_0_hsl(17_70%_40%)] active:translate-y-0 active:shadow-[0_2px_0_hsl(17_70%_40%)] disabled:cursor-not-allowed disabled:opacity-45 disabled:shadow-none" data-testid="button-download-pdf">
              {isBuilding ? <><RotateCcw size={17} className="animate-spin" /> Building your PDF…</> : <><Download size={17} /> Download PDF</>}
            </button>
            {feedback && <div className={`mt-4 flex items-start gap-2 rounded-xl px-3 py-2.5 text-xs font-semibold ${feedback.type === 'success' ? 'bg-[hsl(145_43%_91%)] text-[hsl(145_45%_28%)]' : 'bg-[hsl(var(--destructive)/.1)] text-[hsl(var(--destructive))]'}`} role="status" data-testid={`status-${feedback.type}`}><span className="mt-0.5">{feedback.type === 'success' ? <Check size={14} /> : <X size={14} />}</span>{feedback.message}</div>}
          </aside>
        </section>
        <footer className="mt-12 flex flex-col gap-2 border-t border-[hsl(var(--border))] pt-5 text-[11px] font-semibold uppercase tracking-[.14em] text-[hsl(var(--muted-foreground))] sm:flex-row sm:items-center sm:justify-between"><span>Paper cut, without the paper trail.</span><span>Nothing leaves your device</span></footer>
      </div>
    </main>
  );
}

function Router() {
  return (
    <RoutedErrorBoundary>
      <Switch>
        <Route path="/" component={Home} />
        <Route component={NotFound} />
      </Switch>
    </RoutedErrorBoundary>
  );
}

function RoutedErrorBoundary({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>;
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}><Router /></WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;