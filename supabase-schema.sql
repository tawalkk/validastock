-- Execute no SQL Editor do Supabase antes de usar o ValidaStock.
-- Cada conta só pode ler e alterar seus próprios registros (RLS).
create extension if not exists pgcrypto;

create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null,
  barcode text,
  brand text,
  sector text,
  unit text not null default 'UN',
  created_at timestamptz not null default now(),
  unique(owner_id, barcode)
);
create table if not exists public.lots (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete restrict,
  batch text,
  sector text,
  entry date not null,
  expiry date not null,
  initial numeric(12,3) not null check(initial > 0),
  quantity numeric(12,3) not null check(quantity >= 0),
  created_at timestamptz not null default now(),
  check(expiry >= entry),
  check(quantity <= initial)
);
create table if not exists public.movements (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  lot_id uuid references public.lots(id) on delete set null,
  product_id uuid not null references public.products(id) on delete restrict,
  batch text,
  type text not null check(type in ('entrada','saida','descarte','ajuste_saida')),
  quantity numeric(12,3) not null check(quantity > 0),
  reason text not null,
  at timestamptz not null default now()
);

alter table public.products enable row level security;
alter table public.lots enable row level security;
alter table public.movements enable row level security;
drop policy if exists "owner manages products" on public.products;
create policy "owner manages products" on public.products for all to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());
drop policy if exists "owner manages lots" on public.lots;
create policy "owner manages lots" on public.lots for all to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());
drop policy if exists "owner manages movements" on public.movements;
create policy "owner manages movements" on public.movements for all to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());

-- A validação da propriedade impede ligações entre dados de contas diferentes.
create or replace function public.ensure_owned_refs() returns trigger language plpgsql security invoker as $$
begin
  if not exists(select 1 from public.products p where p.id = new.product_id and p.owner_id = auth.uid()) then
    raise exception 'Produto não encontrado para esta conta';
  end if;
  if tg_table_name = 'lots' then new.owner_id := auth.uid(); end if;
  if tg_table_name = 'movements' and new.lot_id is not null and not exists(select 1 from public.lots l where l.id = new.lot_id and l.owner_id = auth.uid()) then
    raise exception 'Lote não encontrado para esta conta';
  end if;
  return new;
end $$;
drop trigger if exists check_product_owner_on_lots on public.lots;
create trigger check_product_owner_on_lots before insert or update on public.lots for each row execute function public.ensure_owned_refs();
drop trigger if exists check_refs_owner_on_movements on public.movements;
create trigger check_refs_owner_on_movements before insert or update on public.movements for each row execute function public.ensure_owned_refs();

-- Saída/ajuste/descarte e histórico são gravados na mesma transação.
create or replace function public.record_stock_movement(p_lot_id uuid,p_type text,p_quantity numeric,p_reason text)
returns public.movements language plpgsql security invoker set search_path = public as $$
declare l public.lots; m public.movements;
begin
  if p_type not in ('saida','descarte','ajuste_saida') or p_quantity <= 0 or coalesce(trim(p_reason),'') = '' then raise exception 'Dados da movimentação inválidos'; end if;
  select * into l from public.lots where id=p_lot_id and owner_id=auth.uid() for update;
  if not found or p_quantity > l.quantity then raise exception 'Saldo insuficiente ou lote indisponível'; end if;
  update public.lots set quantity=quantity-p_quantity where id=p_lot_id returning * into l;
  insert into public.movements(owner_id,lot_id,product_id,batch,type,quantity,reason)
    values(auth.uid(),l.id,l.product_id,l.batch,p_type,p_quantity,trim(p_reason)) returning * into m;
  return m;
end $$;
grant execute on function public.record_stock_movement(uuid,text,numeric,text) to authenticated;

create or replace function public.record_stock_entry(p_product_id uuid,p_batch text,p_sector text,p_entry date,p_expiry date,p_quantity numeric)
returns public.lots language plpgsql security invoker set search_path = public as $$
declare l public.lots;
begin
  if p_quantity <= 0 or p_expiry < p_entry then raise exception 'Dados do lote inválidos'; end if;
  if not exists(select 1 from public.products where id=p_product_id and owner_id=auth.uid()) then raise exception 'Produto não encontrado para esta conta'; end if;
  insert into public.lots(owner_id,product_id,batch,sector,entry,expiry,initial,quantity)
    values(auth.uid(),p_product_id,nullif(trim(p_batch),''),nullif(trim(p_sector),''),p_entry,p_expiry,p_quantity,p_quantity) returning * into l;
  insert into public.movements(owner_id,lot_id,product_id,batch,type,quantity,reason)
    values(auth.uid(),l.id,l.product_id,l.batch,'entrada',p_quantity,'Entrada de lote');
  return l;
end $$;
grant execute on function public.record_stock_entry(uuid,text,text,date,date,numeric) to authenticated;
revoke all on function public.record_stock_movement(uuid,text,numeric,text) from public, anon;
revoke all on function public.record_stock_entry(uuid,text,text,date,date,numeric) from public, anon;
revoke all on public.products, public.lots, public.movements from anon;
grant select, insert, update, delete on public.products, public.lots, public.movements to authenticated;
