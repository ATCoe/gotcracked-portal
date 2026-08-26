create or replace function public.enforce_public_appointment_store_hours()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  row_data jsonb := to_jsonb(new);
  source_text text := row_data->>'source';
  intake_text text := row_data->>'intake_method';
  target_date date;
  target_time text := nullif(trim(row_data->>'preferred_time'),'');
  hours jsonb;
  tz text;
  day_key text;
  day_label text;
  day_range jsonb;
  store_open time;
  store_close time;
  window_open time;
  window_close time;
begin
  if tg_table_name = 'appointments' then
    if new.lead_id is null then return new; end if;
    select l.source,l.intake_method into source_text,intake_text
    from public.leads l where l.id=new.lead_id;
  end if;

  if source_text is distinct from 'gotcracked.co' or intake_text is distinct from 'walk_in' then return new; end if;
  if nullif(row_data->>'preferred_date','') is null or target_time is null then
    raise exception using errcode='23514', message='Choose a preferred appointment day and time window.';
  end if;
  target_date := (row_data->>'preferred_date')::date;

  select
    coalesce(bs.store_hours,'{"mon":["09:00","18:00"],"tue":["09:00","18:00"],"wed":["09:00","18:00"],"thu":["09:00","18:00"],"fri":["09:00","18:00"],"sat":["10:00","16:00"],"sun":null}'::jsonb),
    coalesce(bs.store_timezone,'America/New_York')
  into hours,tz
  from public.business_settings bs where bs.location_id=new.location_id;

  hours := coalesce(hours,'{"mon":["09:00","18:00"],"tue":["09:00","18:00"],"wed":["09:00","18:00"],"thu":["09:00","18:00"],"fri":["09:00","18:00"],"sat":["10:00","16:00"],"sun":null}'::jsonb);
  tz := coalesce(tz,'America/New_York');
  if target_date < ((current_timestamp at time zone tz)::date) then
    raise exception using errcode='23514', message='Choose today or a future appointment date.';
  end if;

  case extract(isodow from target_date)::int
    when 1 then day_key:='mon'; day_label:='Monday';
    when 2 then day_key:='tue'; day_label:='Tuesday';
    when 3 then day_key:='wed'; day_label:='Wednesday';
    when 4 then day_key:='thu'; day_label:='Thursday';
    when 5 then day_key:='fri'; day_label:='Friday';
    when 6 then day_key:='sat'; day_label:='Saturday';
    else day_key:='sun'; day_label:='Sunday';
  end case;

  day_range := hours->day_key;
  if day_range is null or jsonb_typeof(day_range) <> 'array' or jsonb_array_length(day_range) < 2 then
    raise exception using errcode='23514', message=format('GotCracked is closed on %s. Choose another day.',day_label);
  end if;
  store_open := (day_range->>0)::time;
  store_close := (day_range->>1)::time;

  case target_time
    when 'Morning (9 AM–12 PM)' then window_open:='09:00'::time; window_close:='12:00'::time;
    when 'Afternoon (12–4 PM)' then window_open:='12:00'::time; window_close:='16:00'::time;
    when 'Late afternoon (4–6 PM)' then window_open:='16:00'::time; window_close:='18:00'::time;
    else raise exception using errcode='23514', message='Choose a valid appointment time window.';
  end case;

  if greatest(store_open,window_open) >= least(store_close,window_close) then
    raise exception using errcode='23514', message=format('That time window is outside GotCracked store hours on %s. Choose another time.',day_label);
  end if;
  return new;
end;
$$;
revoke all on function public.enforce_public_appointment_store_hours() from public,anon,authenticated;

drop trigger if exists enforce_public_lead_store_hours on public.leads;
create trigger enforce_public_lead_store_hours
before insert or update of preferred_date,preferred_time on public.leads
for each row execute function public.enforce_public_appointment_store_hours();

drop trigger if exists enforce_public_appointment_store_hours on public.appointments;
create trigger enforce_public_appointment_store_hours
before insert or update of preferred_date,preferred_time,lead_id,location_id on public.appointments
for each row execute function public.enforce_public_appointment_store_hours();
