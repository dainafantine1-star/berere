// Preserve focus when native administrative dialogs close.
for(const dialog of document.querySelectorAll('dialog')){
 let opener;
 const show=dialog.showModal.bind(dialog);
 dialog.showModal=()=>{opener=document.activeElement;show();};
 dialog.addEventListener('close',()=>{if(opener?.isConnected&&!opener.closest('[hidden],[inert]'))opener.focus();});
}
