(() => {
  'use strict';

  const esc=value=>String(value??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'})[c]);
  const ops=()=>window.GotCrackedOperationsV1;

  function decorate(){
    const api=ops(),state=api?.state,intake=state?.intake;
    if(!api||!intake)return;

    // Show pending work orders directly in customer search results.
    document.querySelectorAll('[data-v1-intake-customer]').forEach(button=>{
      if(button.dataset.pendingDecorated)return;
      const customerId=button.dataset.v1IntakeCustomer;
      const pending=state.workOrders.filter(ticket=>ticket.customer_id===customerId&&ticket.status==='awaiting_customer');
      if(pending.length){
        button.dataset.pendingDecorated='1';
        button.insertAdjacentHTML('beforeend',`<small class="v1-success">${pending.map(ticket=>`Pending ${esc(`GC-${String(ticket.ticket_number).padStart(6,'0')}`)} · Awaiting Customer`).join(' · ')}</small>`);
      }
    });

    if(intake.step!==1||!intake.customer)return;
    const body=document.querySelector('#v1-intake-dialog .v1-intake-body');
    if(!body||body.querySelector('.v1-pending-arrivals'))return;
    const pending=state.workOrders.filter(ticket=>ticket.customer_id===intake.customer.id&&ticket.status==='awaiting_customer');
    if(!pending.length)return;

    const panel=document.createElement('section');
    panel.className='v1-pending-arrivals v1-review-card';
    panel.innerHTML=`<h4>Pending arrival${pending.length===1?'':'s'} found</h4><p>This customer already has a pre-created work order. Resume it instead of creating a duplicate.</p><div class="v1-inline-actions">${pending.map(ticket=>`<button type="button" class="secondary-button" data-v1-resume-pending="${ticket.id}"><strong>Resume GC-${String(ticket.ticket_number).padStart(6,'0')}</strong><br><small>${esc(ticket.customer_issue||'Pending repair')}</small></button>`).join('')}</div>`;
    body.prepend(panel);
  }

  document.addEventListener('input',event=>{
    if(event.target.id==='v1-intake-search')setTimeout(decorate,0);
  });
  document.addEventListener('click',event=>{
    if(event.target.closest('[data-v1-intake-customer],[data-v1-intake-next],[data-v1-intake-prev]'))setTimeout(decorate,0);
    const resume=event.target.closest('[data-v1-resume-pending]');
    if(!resume)return;
    event.preventDefault();event.stopPropagation();
    const api=ops(),state=api?.state;if(!api||!state)return;
    const ticket=state.workOrders.find(item=>item.id===resume.dataset.v1ResumePending);if(!ticket)return;
    const customer=state.customers.find(item=>item.id===ticket.customer_id)||ticket.customers;
    const device=(customer?.devices||[]).find(item=>item.id===ticket.device_id)||ticket.devices;
    api.openIntake({customer,device,pendingTicket:ticket,customer_issue:ticket.customer_issue});
    setTimeout(()=>document.querySelector('#v1-intake-dialog [data-v1-intake-next]')?.click(),0);
  },true);

  const observer=new MutationObserver(()=>{
    if(document.getElementById('v1-intake-dialog')?.open)decorate();
  });
  observer.observe(document.documentElement,{subtree:true,childList:true});
})();
