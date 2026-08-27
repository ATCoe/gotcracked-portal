-- GotCracked Knowledge Base: core multi-device diagnostic expansion
-- These are original GotCracked technician procedures. External copyrighted guide text/images are not copied.

with seed(slug, device_category, manufacturer, model_family, kind, symptom, title, tags, difficulty, bench_time_minutes) as (
  values
    ('phone-no-power','Phone',null,null,'power','No power, black screen, or appears dead','Phone no-power diagnostic path',array['phone','no power','dead','battery','charging']::text[],'Intermediate',30),
    ('phone-audio','Phone',null,null,'audio','Speaker, earpiece, microphone, or call-audio failure','Phone audio / microphone diagnostic path',array['phone','speaker','microphone','earpiece','audio']::text[],'Easy-Intermediate',25),
    ('phone-camera-biometric','Phone',null,null,'camera','Camera, autofocus, Face ID, or fingerprint failure','Phone camera / biometric diagnostic path',array['phone','camera','face id','fingerprint','biometric']::text[],'Intermediate',35),
    ('phone-bootloop','Phone',null,null,'boot','Boot loop, stuck logo, recovery mode, update failure, or random restart','Phone boot-loop / software triage',array['phone','bootloop','recovery','update','restart']::text[],'Intermediate',45),
    ('phone-foldable-hinge','Phone',null,'Foldables','foldable','Inner display line, hinge damage, lifting protector, or abnormal opening angle','Foldable phone hinge / display triage',array['phone','foldable','hinge','flexible oled','screen']::text[],'Advanced',75),

    ('tablet-display-touch','Tablet',null,null,'display','Cracked glass, no image, ghost touch, dead touch zones, or display artifacts','Tablet display / digitizer diagnostic path',array['tablet','display','digitizer','touch','screen']::text[],'Intermediate',45),
    ('tablet-battery-charge','Tablet',null,null,'charging','No charge, rapid drain, swelling, intermittent USB-C/Lightning, or unexpected shutdown','Tablet battery / charging diagnostic path',array['tablet','battery','charging','usb-c','lightning']::text[],'Intermediate',45),
    ('tablet-no-power','Tablet',null,null,'power','No power, no boot, black screen, or device appears dead','Tablet no-power / no-boot triage',array['tablet','no power','dead','battery','board']::text[],'Intermediate',40),
    ('tablet-software-boot','Tablet',null,null,'boot','Boot loop, recovery failure, update issue, or OS corruption','Tablet software / boot diagnostic path',array['tablet','bootloop','recovery','update','software']::text[],'Intermediate',45),
    ('tablet-liquid','Tablet',null,null,'liquid','Liquid exposure, corrosion, intermittent faults, or no power after spill','Tablet liquid-exposure triage',array['tablet','liquid','water','corrosion','no power']::text[],'Advanced',75),

    ('laptop-no-power-post','Laptop',null,null,'post','No power, powers on with no POST, black screen, or diagnostic blink/beep code','Laptop no-power / no-POST diagnostic path',array['laptop','no power','post','bios','memory']::text[],'Intermediate',45),
    ('laptop-charging-battery','Laptop',null,null,'charging','Will not charge, battery not detected, rapid drain, or intermittent DC/USB-C input','Laptop charging / battery diagnostic path',array['laptop','battery','charging','usb-c','dc jack']::text[],'Intermediate',40),
    ('laptop-display-video','Laptop',null,null,'display','Internal display black, flickering, dim, cracked, or external-only video','Laptop display / no-video diagnostic path',array['laptop','display','edp','backlight','no video']::text[],'Intermediate',45),
    ('laptop-liquid','Laptop',null,null,'liquid','Liquid spill, corrosion, keyboard failure, no power, or intermittent behavior','Laptop liquid-exposure triage',array['laptop','liquid','corrosion','keyboard','board']::text[],'Advanced',90),
    ('laptop-storage-boot','Laptop',null,null,'storage','No boot device, SMART warning, slow boot, OS corruption, or storage not detected','Laptop storage / boot diagnostic path',array['laptop','ssd','nvme','storage','boot']::text[],'Intermediate',45),

    ('desktop-no-post','Desktop',null,null,'post','No POST, powers on with no display, beep/debug code, or boot loop','Desktop PC no-POST diagnostic path',array['desktop','pc','post','memory','bios']::text[],'Intermediate',45),
    ('desktop-psu-power','Desktop',null,null,'power','No power, instant shutdown, random restart, or unstable system under load','Desktop PSU / power diagnostic path',array['desktop','pc','psu','power','shutdown']::text[],'Intermediate',45),
    ('desktop-gpu-display','Desktop',null,null,'display','No display, artifacts, driver crash, black screen under load, or GPU not detected','Desktop GPU / no-display diagnostic path',array['desktop','gpu','graphics','no display','artifacts']::text[],'Intermediate-Advanced',60),
    ('desktop-storage-boot','Desktop',null,null,'storage','No boot device, drive not detected, SMART errors, slow storage, or OS boot failure','Desktop storage / boot diagnostic path',array['desktop','ssd','nvme','hdd','boot']::text[],'Intermediate',45),
    ('desktop-thermal','Desktop',null,null,'thermal','Overheating, thermal throttling, loud fans, shutdown, or high idle temperature','Desktop thermal / cooling diagnostic path',array['desktop','thermal','fan','cooling','overheating']::text[],'Intermediate',45),

    ('console-power-shutdown','Console',null,null,'power','No power, powers off immediately, power cycling, or random shutdown','Console power / shutdown diagnostic path',array['console','no power','shutdown','psu','battery']::text[],'Advanced',60),
    ('console-thermal','Console',null,null,'thermal','Overheating warning, loud fan, thermal shutdown, or excessive heat','Console thermal / cooling diagnostic path',array['console','thermal','fan','overheating','shutdown']::text[],'Intermediate',60),
    ('console-disc-drive','Console',null,null,'optical','Disc will not accept, eject, spin, read, or install reliably','Console optical-drive diagnostic path',array['console','disc drive','optical','laser','eject']::text[],'Intermediate',60),
    ('console-controller','Console',null,null,'controller','Stick drift, dead buttons, trigger fault, pairing failure, or intermittent input','Console controller diagnostic path',array['console','controller','stick drift','joystick','buttons']::text[],'Intermediate',45),
    ('console-dock-output','Console',null,null,'dock','Handheld console works locally but dock or external display output fails','Handheld console dock / external-output diagnostic path',array['console','handheld','dock','hdmi','usb-c']::text[],'Intermediate',45),
    ('console-usbc-charge','Console',null,null,'charging','Handheld console will not charge, has damaged USB-C, or charges intermittently','Handheld console USB-C / charging triage',array['console','handheld','usb-c','charging','battery']::text[],'Advanced',75),
    ('console-system-software','Console',null,null,'boot','Safe-mode, update, recovery, storage, or system-software failure','Console system-software / recovery triage',array['console','safe mode','recovery','update','storage']::text[],'Intermediate',45),
    ('console-liquid','Console',null,null,'liquid','Liquid exposure, corrosion, no power, or intermittent behavior after spill','Console liquid-exposure triage',array['console','liquid','corrosion','water','board']::text[],'Advanced',90)
), expanded as (
  select
    s.*,
    case s.kind
      when 'power' then 'Separate external power, battery or PSU, charging path, display masking, protection shutdown, and board-level power faults before replacing parts.'
      when 'charging' then 'Separate power source, connector, battery, charge circuitry, cable, and software or firmware causes using known-good references and controlled testing.'
      when 'display' then 'Separate panel or display assembly faults from cable, connector, GPU or video path, settings, backlight, and board-level causes.'
      when 'audio' then 'Separate debris, acoustic path, modular speaker or microphone, flex and connector, software, and board-level audio faults.'
      when 'camera' then 'Separate software or permissions, module damage, connector faults, calibration or pairing requirements, and board-level sensor faults.'
      when 'boot' then 'Protect customer data while separating recoverable software, storage, power instability, failed peripherals, and board-level faults.'
      when 'foldable' then 'Treat flexible OLED, hinge geometry, frame deformation, debris, and paired assemblies as a coupled mechanical and display system.'
      when 'liquid' then 'Prioritize power isolation, safety, corrosion mapping, data preservation, and controlled board inspection before normal functional testing.'
      when 'post' then 'Use POST behavior, diagnostic codes, minimum hardware configuration, known-good components, and firmware state to isolate the failed subsystem.'
      when 'storage' then 'Separate media health, connection, firmware or BIOS detection, filesystem or OS damage, and controller or board faults before destructive recovery.'
      when 'thermal' then 'Confirm temperature and load behavior, airflow, fan operation, heatsink contact, thermal interface condition, and sensor or board faults.'
      when 'optical' then 'Separate media condition, mechanism, motor, optical pickup, cable or connector, firmware, and drive electronics before replacement.'
      when 'controller' then 'Separate firmware and calibration, contamination, mechanical wear, battery or wired connection, modular controls, and controller-board faults.'
      when 'dock' then 'Separate display and cable chain, dock or adapter, USB-C connector, power-delivery negotiation, settings, and board-level video path.'
      else 'Use a controlled known-good process to isolate the failed subsystem before parts replacement.'
    end as summary,
    case s.kind
      when 'power' then jsonb_build_array('Document impact, liquid, prior repair, power behavior, lights, sounds, current draw, and shutdown timing.','Inspect for swelling, corrosion, damaged connectors, burnt areas, and mechanical damage before applying power.','Verify the correct known-good power source and isolate replaceable battery, PSU, charging, display, or peripheral causes where applicable.','Escalate to model-specific board diagnostics only after simpler causes are excluded; complete full functional testing after repair.')
      when 'charging' then jsonb_build_array('Verify the complaint with a correct known-good charger, cable, outlet, and supported charging method.','Inspect connector pins, debris, looseness, battery condition, heat, and liquid or impact evidence.','Use OEM diagnostics or power measurements where appropriate; isolate battery, port or daughterboard, cable, and charge-circuit causes.','After repair verify charge negotiation, battery recognition, temperature, data connectivity where applicable, and stable operation.')
      when 'display' then jsonb_build_array('Confirm whether the device is booting despite no image and test an external display when the platform supports it.','Inspect panel, frame, hinges or enclosure, display cable or flex, connectors, and impact or liquid damage.','Use known-good display components or OEM diagnostics where practical before escalating to GPU, backlight, retimer, or board-level video diagnosis.','Verify image, brightness, touch where present, sleep or wake, external output, and stability after repair.')
      when 'audio' then jsonb_build_array('Reproduce the failure using calls, recording, playback, speakerphone, and known-good media or accessories.','Inspect acoustic meshes, ports, liquid residue, connectors, and flexes before opening or replacing modules.','Test software settings and OEM diagnostics, then isolate speaker, microphone, earpiece, cable, or board path.','Verify every microphone and speaker mode after repair.')
      when 'camera' then jsonb_build_array('Check permissions, software state, camera switching, focus, flash, and biometric enrollment before opening.','Run OEM diagnostics or calibration tools when available and document pairing or calibration warnings.','Inspect lens glass, module seating, sensor windows, flexes, and impact damage; avoid sacrificing paired original parts unnecessarily.','Verify cameras, stabilization, flash, proximity or ambient sensors, and biometrics after repair.')
      when 'boot' then jsonb_build_array('Record exact boot stage, error codes, update history, free-storage symptoms, and available recovery or safe modes.','Confirm stable power before update or recovery work and back up accessible customer data when authorized.','Use manufacturer-supported non-destructive recovery first; obtain authorization before erase, restore, reimage, or factory-reset actions.','If supported recovery repeatedly fails, isolate storage, peripheral, power, or board causes and document final verification.')
      when 'foldable' then jsonb_build_array('Photograph the device closed, partially open, and fully open; record hinge angle, noise, resistance, gaps, crease, protector, and frame condition.','Do not repeatedly flex a device with lifting OLED, grinding hinge, exposed crease damage, or suspected debris.','Test both displays, all touch zones, cameras, audio, charging, wireless, and orientation sensors before quoting.','Use the exact OEM or licensed model procedure and confirm whether the repair requires a complete display-frame-hinge assembly or post-repair calibration.')
      when 'liquid' then jsonb_build_array('Document liquid type, exposure time, affected area, and whether the device was powered or charged after exposure.','Disconnect external power and the battery where safely serviceable; do not repeatedly power-test a recently wet device.','Inspect under magnification for residue and corrosion around ports, shields, power circuits, connectors, and high-risk components; preserve data priorities.','Clean or repair using electronics-safe methods, then power under controlled conditions and perform a complete functional test.')
      when 'post' then jsonb_build_array('Record fans, LEDs, debug codes, beeps, display output, restart timing, and recent hardware or firmware changes.','Reduce to minimum required hardware and reseat or test memory, power connections, display path, and removable components with known-good parts where practical.','Check OEM diagnostics and BIOS or UEFI recovery options before replacing the board.','After repair run memory, CPU, storage, GPU, ports, networking, audio, and sustained-load testing.')
      when 'storage' then jsonb_build_array('Document detection in BIOS or UEFI, SMART or OEM diagnostics, boot errors, noise, speed, and customer data priority.','Inspect cables, sockets, power, thermal pads, and physical media condition; test in a known-good environment when safe.','Attempt non-destructive filesystem or OS repair only after storage health is understood; obtain authorization before destructive recovery.','After replacement or repair verify firmware detection, health data, sustained transfers, boot reliability, and backups as appropriate.')
      when 'thermal' then jsonb_build_array('Record idle and load temperatures, fan behavior, throttling, shutdown timing, ambient conditions, and workload.','Inspect vents, dust, fan bearings, heatsink mounting, thermal pads or paste, and enclosure airflow.','Run controlled load testing before and after service to confirm the actual thermal delta.','Verify stable temperatures, fan control, performance, and shutdown protection after repair.')
      when 'optical' then jsonb_build_array('Test multiple known-good supported discs and document intake, eject, spin, read, and install behavior.','Inspect mechanism, rollers, contamination, cable or connector damage, and signs of impact.','Use the exact model teardown and pairing rules before replacing optical components or drive electronics.','Verify read, install, eject, and repeated cold-start operation after repair.')
      when 'controller' then jsonb_build_array('Update firmware and record raw input or calibration behavior on a known-good host.','Inspect sticks, buttons, triggers, rails or ports, battery contacts, contamination, and impact damage.','Isolate modular controls before board repair; protect pads when desoldering multi-pin analog modules.','Calibrate and verify full range, center, buttons, triggers, motion, vibration, wired and wireless functions after repair.')
      when 'dock' then jsonb_build_array('Confirm handheld operation, then test the correct known-good display, cable, power adapter, and dock for the exact model.','Inspect USB-C and HDMI connectors for damaged pins, looseness, contamination, and impact.','Power-cycle the chain and isolate dock, adapter, cable, console port, software settings, and board video path.','Verify charging, data or accessories, and stable external video at supported modes after repair.')
      else jsonb_build_array('Reproduce and document the complaint.','Inspect and isolate simple causes with known-good components.','Use the exact model service reference before internal work.','Complete full functional testing after repair.')
    end as diagnostic_steps,
    case s.kind
      when 'power' then jsonb_build_array('Battery or PSU failure','Damaged charging or power connector','Shorted peripheral','Display masking successful boot','Board-level power fault')
      when 'charging' then jsonb_build_array('Bad charger or cable','Contaminated or damaged port','Battery failure','Charge-circuit fault','Software or firmware issue')
      when 'display' then jsonb_build_array('Display assembly or panel failure','Cable or connector damage','Backlight or power fault','GPU or video-path fault','Software or display-setting issue')
      when 'audio' then jsonb_build_array('Blocked acoustic path','Speaker or microphone module failure','Flex or connector fault','Liquid corrosion','Board-level audio fault')
      when 'camera' then jsonb_build_array('Camera or sensor module failure','Lens or window damage','Flex or connector fault','Calibration or pairing issue','Board-level sensor fault')
      when 'boot' then jsonb_build_array('Corrupt OS or firmware','Insufficient or failed storage','Power instability','Failed peripheral','Board-level fault')
      when 'foldable' then jsonb_build_array('Flexible OLED damage','Hinge or debris failure','Frame deformation','Display flex damage','Adhesive or protector failure')
      when 'liquid' then jsonb_build_array('Connector corrosion','Board corrosion or short','Battery or PSU damage','Module or flex damage','Residue causing intermittent leakage')
      when 'post' then jsonb_build_array('Memory fault','Power delivery fault','Firmware or BIOS issue','GPU or peripheral fault','Motherboard or CPU fault')
      when 'storage' then jsonb_build_array('Failed SSD or HDD','Connection or power fault','Corrupt filesystem or OS','Firmware or controller fault','Thermal or board issue')
      when 'thermal' then jsonb_build_array('Dust restriction','Fan failure','Poor heatsink contact','Degraded thermal interface','Sensor or board fault')
      when 'optical' then jsonb_build_array('Contaminated or failed pickup','Mechanism or motor fault','Cable or connector issue','Paired electronics fault','Firmware or media issue')
      when 'controller' then jsonb_build_array('Worn analog module','Contamination','Calibration or firmware issue','Battery or connection fault','Controller PCB damage')
      when 'dock' then jsonb_build_array('Dock or adapter failure','Bad HDMI or display chain','Damaged USB-C connector','Power-delivery or video-path IC fault','Software or display setting')
      else jsonb_build_array('Replaceable module fault','Connection fault','Software issue','Board-level fault')
    end as likely_causes
  from seed s
)
insert into public.repair_guides (
  slug, device_category, manufacturer, model_family, symptom, title, summary,
  diagnostic_steps, likely_causes, tools_notes, parts_notes, cautions, tags,
  difficulty, bench_time_minutes, active, source_type, source_name,
  verified_at, verification_notes, procedure_version
)
select
  e.slug, e.device_category, e.manufacturer, e.model_family, e.symptom, e.title, e.summary,
  e.diagnostic_steps, e.likely_causes,
  'Use ESD-safe tools, known-good test equipment, OEM diagnostics where available, and the exact model service reference before disassembly.',
  'Confirm exact model, board or regional revision, part compatibility, calibration or pairing requirements, and data-preservation goals before installation.',
  case when e.kind='liquid' then 'Do not energize wet or corroded equipment. Lithium batteries and mains-powered supplies require appropriate isolation and safety procedures.' when e.kind='foldable' then 'Never force a damaged hinge or repeatedly flex a compromised flexible OLED.' else 'Stop normal testing for swollen or damaged batteries, active liquid, smoke, burning odor, abnormal heat, exposed mains hazards, or severe board damage.' end,
  e.tags, e.difficulty, e.bench_time_minutes, true, 'internal', 'GotCracked', now(),
  'Original GotCracked procedure reviewed against authoritative repair references available as of 2026-08-27.', 1
from expanded e
where not exists (
  select 1 from public.repair_guides g
  where g.location_id is null and g.slug=e.slug
);
