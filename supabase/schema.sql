-- AutoSetu starter schema for a NEW Supabase project.
-- If your existing project already contains tables, inspect and merge rather than blindly rerunning.
create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null default 'AutoSetu user',
  role text not null default 'passenger' check (role in ('passenger','driver')),
  phone text,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.drivers (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  is_online boolean not null default false,
  verification_status text not null default 'pending' check (verification_status in ('pending','verified','rejected')),
  vehicle_type text,
  vehicle_registration text,
  license_status text not null default 'pending' check (license_status in ('pending','verified','rejected')),
  insurance_status text not null default 'pending' check (insurance_status in ('pending','verified','rejected')),
  rating numeric(2,1) not null default 5.0 check (rating >= 0 and rating <= 5),
  last_latitude double precision,
  last_longitude double precision,
  last_location_updated_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.rides (
  id uuid primary key default gen_random_uuid(),
  passenger_id uuid not null references public.profiles(id) on delete restrict,
  driver_id uuid references public.profiles(id) on delete set null,
  pickup_text text not null,
  destination_text text not null,
  ride_type text not null default 'auto' check (ride_type in ('auto','taxi')),
  status text not null default 'requested' check (status in ('requested','accepted','driver_on_the_way','arrived','started','completed','cancelled')),
  agreed_fare numeric(10,2) check (agreed_fare is null or agreed_fare >= 0),
  cancellation_reason text,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create table if not exists public.carpools (
  id uuid primary key default gen_random_uuid(),
  driver_id uuid not null references public.profiles(id) on delete cascade,
  origin_text text not null,
  destination_text text not null,
  departure_at timestamptz not null,
  available_seats integer not null check (available_seats between 1 and 8),
  vehicle_info text,
  cost_contribution numeric(10,2) check (cost_contribution is null or cost_contribution >= 0),
  status text not null default 'published' check (status in ('published','full','cancelled','completed')),
  created_at timestamptz not null default now()
);

create table if not exists public.carpool_requests (
  id uuid primary key default gen_random_uuid(),
  carpool_id uuid not null references public.carpools(id) on delete cascade,
  passenger_id uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'requested' check (status in ('requested','accepted','rejected','cancelled')),
  created_at timestamptz not null default now(),
  unique(carpool_id, passenger_id)
);

create table if not exists public.reviews (
  id uuid primary key default gen_random_uuid(),
  ride_id uuid not null references public.rides(id) on delete cascade,
  reviewer_id uuid not null references public.profiles(id) on delete cascade,
  reviewee_id uuid not null references public.profiles(id) on delete cascade,
  rating integer not null check (rating between 1 and 5),
  comment text,
  created_at timestamptz not null default now(),
  unique(ride_id, reviewer_id)
);

create table if not exists public.user_reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references public.profiles(id) on delete cascade,
  reported_user_id uuid not null references public.profiles(id) on delete cascade,
  ride_id uuid references public.rides(id) on delete set null,
  category text not null,
  description text,
  status text not null default 'open' check (status in ('open','reviewing','resolved','dismissed')),
  created_at timestamptz not null default now()
);

-- Keep profile creation server-side so signup metadata becomes a profile row.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name, role)
  values (
    new.id,
    coalesce(nullif(new.raw_user_meta_data ->> 'full_name',''), split_part(coalesce(new.email,''),'@',1), 'AutoSetu user'),
    case when new.raw_user_meta_data ->> 'role' = 'driver' then 'driver' else 'passenger' end
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute procedure public.handle_new_user();

create or replace function public.set_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin new.updated_at = now(); return new; end; $$;
drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at before update on public.profiles
for each row execute procedure public.set_updated_at();

alter table public.profiles enable row level security;
alter table public.drivers enable row level security;
alter table public.rides enable row level security;
alter table public.carpools enable row level security;
alter table public.carpool_requests enable row level security;
alter table public.reviews enable row level security;
alter table public.user_reports enable row level security;

-- Profiles: users can read and update their own profile, not change their role through normal updates.
drop policy if exists "profiles_select_self" on public.profiles;
create policy "profiles_select_self" on public.profiles for select to authenticated using (id = auth.uid());
-- Prevent users from changing their own role (for example, passenger -> driver).
create or replace function public.prevent_profile_role_change()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.role is distinct from old.role then
    raise exception 'Profile role cannot be changed by the account owner';
  end if;
  return new;
end;
$$;
drop trigger if exists profiles_protect_role on public.profiles;
create trigger profiles_protect_role before update on public.profiles
for each row execute procedure public.prevent_profile_role_change();

drop policy if exists "profiles_update_self" on public.profiles;
create policy "profiles_update_self" on public.profiles for update to authenticated
using (id = auth.uid()) with check (id = auth.uid());

-- Driver records: users may see their own record; authenticated users can see online status/listing fields.
drop policy if exists "drivers_select_authenticated" on public.drivers;
create policy "drivers_select_authenticated" on public.drivers for select to authenticated using (true);
drop policy if exists "drivers_insert_self" on public.drivers;
create policy "drivers_insert_self" on public.drivers for insert to authenticated with check (
  user_id = auth.uid()
  and (select p.role from public.profiles p where p.id = auth.uid()) = 'driver'
  and verification_status = 'pending' and license_status = 'pending'
  and insurance_status = 'pending' and rating = 5.0
);
-- Ordinary drivers may update availability/location, but cannot self-verify or edit their rating.
create or replace function public.protect_driver_verification_fields()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.verification_status is distinct from old.verification_status
     or new.license_status is distinct from old.license_status
     or new.insurance_status is distinct from old.insurance_status
     or new.rating is distinct from old.rating then
    raise exception 'Verification and rating fields can only be changed by an authorized administrator';
  end if;
  return new;
end;
$$;
drop trigger if exists drivers_protect_verification_fields on public.drivers;
create trigger drivers_protect_verification_fields before update on public.drivers
for each row execute procedure public.protect_driver_verification_fields();

drop policy if exists "drivers_update_self" on public.drivers;
create policy "drivers_update_self" on public.drivers for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Rides: passenger owns their requests; drivers can see requests and rides assigned to them.
drop policy if exists "rides_select_participants_or_driver_requests" on public.rides;
create policy "rides_select_participants_or_driver_requests" on public.rides for select to authenticated using (
  passenger_id = auth.uid() or driver_id = auth.uid() or (driver_id is null and (select p.role from public.profiles p where p.id = auth.uid()) = 'driver')
);
drop policy if exists "rides_insert_passenger" on public.rides;
create policy "rides_insert_passenger" on public.rides for insert to authenticated with check (passenger_id = auth.uid() and (select p.role from public.profiles p where p.id = auth.uid()) = 'passenger' and driver_id is null and status = 'requested');
drop policy if exists "rides_update_participants" on public.rides;
create policy "rides_update_participants" on public.rides for update to authenticated using (
  passenger_id = auth.uid() or driver_id = auth.uid() or (driver_id is null and (select p.role from public.profiles p where p.id = auth.uid()) = 'driver')
) with check (
  passenger_id = auth.uid() or driver_id = auth.uid()
);

-- Carpools: published listings visible to authenticated users; only driver owner creates/edits.
drop policy if exists "carpools_select_authenticated" on public.carpools;
create policy "carpools_select_authenticated" on public.carpools for select to authenticated using (true);
drop policy if exists "carpools_insert_driver" on public.carpools;
create policy "carpools_insert_driver" on public.carpools for insert to authenticated with check (driver_id = auth.uid() and (select p.role from public.profiles p where p.id = auth.uid()) = 'driver');
drop policy if exists "carpools_update_owner" on public.carpools;
create policy "carpools_update_owner" on public.carpools for update to authenticated using (driver_id = auth.uid()) with check (driver_id = auth.uid());

-- Carpool requests: passenger controls own request; owner driver can review requests for their listing.
drop policy if exists "carpool_requests_select_participants" on public.carpool_requests;
create policy "carpool_requests_select_participants" on public.carpool_requests for select to authenticated using (
  passenger_id = auth.uid() or exists (select 1 from public.carpools c where c.id = carpool_id and c.driver_id = auth.uid())
);
drop policy if exists "carpool_requests_insert_passenger" on public.carpool_requests;
create policy "carpool_requests_insert_passenger" on public.carpool_requests for insert to authenticated with check (passenger_id = auth.uid() and (select p.role from public.profiles p where p.id = auth.uid()) = 'passenger');
drop policy if exists "carpool_requests_update_participants" on public.carpool_requests;
create policy "carpool_requests_update_participants" on public.carpool_requests for update to authenticated using (
  passenger_id = auth.uid() or exists (select 1 from public.carpools c where c.id = carpool_id and c.driver_id = auth.uid())
) with check (
  passenger_id = auth.uid() or exists (select 1 from public.carpools c where c.id = carpool_id and c.driver_id = auth.uid())
);

drop policy if exists "reviews_select_authenticated" on public.reviews;
create policy "reviews_select_authenticated" on public.reviews for select to authenticated using (true);
drop policy if exists "reviews_insert_reviewer" on public.reviews;
create policy "reviews_insert_reviewer" on public.reviews for insert to authenticated with check (reviewer_id = auth.uid());

drop policy if exists "reports_insert_self" on public.user_reports;
create policy "reports_insert_self" on public.user_reports for insert to authenticated with check (reporter_id = auth.uid());
drop policy if exists "reports_select_reporter" on public.user_reports;
create policy "reports_select_reporter" on public.user_reports for select to authenticated using (reporter_id = auth.uid());

grant usage on schema public to authenticated;
grant select, insert, update on public.profiles to authenticated;
grant select, insert, update on public.drivers to authenticated;
grant select, insert, update on public.rides to authenticated;
grant select, insert, update on public.carpools to authenticated;
grant select, insert, update on public.carpool_requests to authenticated;
grant select, insert on public.reviews to authenticated;
grant select, insert on public.user_reports to authenticated;
