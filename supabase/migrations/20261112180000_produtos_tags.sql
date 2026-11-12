-- Catálogo: tags, tipo, fornecedor e data de criação de cada produto (base dos códigos AP/AB).
alter table public.products add column if not exists tags text[] not null default '{}';
alter table public.products add column if not exists product_type text;
alter table public.products add column if not exists vendor text;
alter table public.products add column if not exists created_at timestamptz;
