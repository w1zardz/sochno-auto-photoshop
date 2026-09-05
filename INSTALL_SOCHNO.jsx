#target photoshop
/* Run once. Installs into the user's Adobe data folder and adds an F6 action.
   Keeps existing action sets. The ATN uses Adobe's documented binary format. */
(function () {
    var here=File($.fileName).parent,source=File(here+'/SOCHNO_AUTO.jsx');
    var dest=Folder(Folder.userData+'/SOCHNO AUTO');
    function u16(n){return String.fromCharCode((n>>>8)&255,n&255);}
    function u32(n){return u16((n>>>16)&65535)+u16(n&65535);}
    function unicode(s){var v=u32(s.length+1);for(var i=0;i<s.length;i++)v+=u16(s.charCodeAt(i));return v+u16(0);}
    function ascii(s){return u32(s.length)+s;}
    try {
        if(!source.exists)throw Error('Положи INSTALL_SOCHNO.jsx рядом с SOCHNO_AUTO.jsx.');
        if(!dest.exists&&!dest.create())throw Error('Не удалось создать '+dest.fsName);
        var installed=File(dest+'/SOCHNO_AUTO.jsx');
        if(source.fsName!==installed.fsName&&!source.copy(installed))throw Error('Не удалось скопировать скрипт.');
        var descriptor=new ActionDescriptor();descriptor.putPath(charIDToTypeID('jsCt'),installed);
        descriptor.putString(stringIDToTypeID('javaScriptMessage'),'undefined');
        var setName='SOCHNO AUTO',actionName='SOCHNO — ЖЁСТКИЙ АВТОФИНИШ';
        var data=u32(16)+unicode(setName)+'\x01'+u32(1);
        data+=u16(6)+'\x00\x00'+u16(3)+unicode(actionName)+'\x00'+u32(1);
        // toStream() prefixes a descriptor with a version word; ATN embeds the
        // descriptor body directly, without that four-byte stream header.
        data+='\x00\x01\x00\x00TEXT'+ascii('AdobeScriptAutomation Scripts')+ascii('Scripts')+u32(0xffffffff)+descriptor.toStream().substr(4);
        var atn=File(dest+'/SOCHNO_AUTO.atn');atn.encoding='BINARY';
        if(!atn.open('w'))throw Error('Не удалось записать операцию.');atn.write(data);atn.close();
        // Reload only our exact set on installer reruns.
        try {
            var ref=new ActionReference();ref.putName(charIDToTypeID('ASet'),setName);executeActionGet(ref);
            var del=new ActionDescriptor();del.putReference(charIDToTypeID('null'),ref);executeAction(charIDToTypeID('Dlt '),del,DialogModes.NO);
        } catch(absent) {}
        app.load(atn);
        var verify=new ActionReference();verify.putName(charIDToTypeID('ASet'),setName);executeActionGet(verify);
        atn.copy(File(here+'/SOCHNO_AUTO.atn'));
        if(!$.global.SOCHNO_QUIET_INSTALL)alert('SOCHNO AUTO установлен.\n\nОткрой превью и нажми F6.\nВсе параметры подбираются автоматически.\n\nОперация также есть в Окно → Операции → SOCHNO AUTO.');
    } catch(e) {if($.global.SOCHNO_QUIET_INSTALL)throw e;alert('SOCHNO: '+e.message);}
})();
