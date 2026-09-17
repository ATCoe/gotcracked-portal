insert into public.marlon_web_sources(source_name,category,url,tags,trust_level,live_fetch,notes) values
('RepairShopr','business','https://www.repairshopr.com/',array['repair-shop','portal','tickets','crm','inventory','estimates','pos','customer-portal'],'reference',true,'Functional benchmark only. Compare workflow completeness; never copy proprietary UI, text, branding, or code.'),
('Fixably','business','https://www.fixably.com/',array['repair-shop','workflow','inventory','serialized-parts','logistics','check-in'],'reference',true,'Functional benchmark only. Use to identify mature repair-operations patterns; preserve GotCracked original design and architecture.'),
('Orderry','business','https://orderry.com/',array['repair-shop','work-orders','mobile','kpi','reporting','inventory'],'reference',true,'Functional benchmark only. Use category-level capabilities and workflow concepts, not proprietary implementation details.'),
('RepairDesk','business','https://www.repairdesk.co/',array['repair-shop','pos','tickets','inventory','customer-management','reporting'],'reference',true,'Functional benchmark only. Compare feature coverage and operational workflow; do not clone interface or proprietary content.')
on conflict (url) do update set
  source_name=excluded.source_name,category=excluded.category,tags=excluded.tags,
  trust_level=excluded.trust_level,live_fetch=excluded.live_fetch,notes=excluded.notes,
  active=true,updated_at=now();
