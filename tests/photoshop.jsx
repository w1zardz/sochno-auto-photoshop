#target photoshop
/* Integration tests. Run with an RGB thumbnail in one artboard open. Only temporary copies are changed.
   Set $.global.SOCHNO_TEST_OUTPUT to a folder to collect the log and PNG previews. */
(function () {
    if(!app.documents.length)throw Error('Open an RGB thumbnail before running tests.');
    var root=File($.fileName).parent.parent,out=Folder($.global.SOCHNO_TEST_OUTPUT||Folder.temp+'/SOCHNO-tests');
    if(!out.exists&&!out.create())throw Error('Cannot create test output folder');
    var user=app.activeDocument,base=null,doc=null,preview=null,initialDocs=app.documents.length;
    var dialogs=app.displayDialogs,units=app.preferences.rulerUnits,autorun=$.global.SOCHNO_NO_AUTORUN;
    var library=File(root+'/SOCHNO_AUTO.jsx');library.encoding='UTF8';library.open('r');var code=library.read();library.close();
    function log(s){var f=File(out+'/results.txt');f.encoding='UTF8';f.open('a');f.writeln(s);f.close();}
    function assert(ok,msg){if(!ok)throw Error(msg);}
    function owned(p,arr) {
        for(var i=0;i<p.layerSets.length;i++) {
            var g=p.layerSets[i],ours=false;
            for(var j=0;j<g.artLayers.length;j++)if(g.artLayers[j].name==='SOCHNO_SOURCE_v1')ours=true;
            if(g.name.indexOf('SOCHNO AUTO')===0&&ours)arr.push(g);else owned(g,arr);
        }
    }
    function selectionBounds(d){var b=d.selection.bounds;return [b[0].as('px'),b[1].as('px'),b[2].as('px'),b[3].as('px')].join(',');}
    function userLayers(p,items) {
        for(var i=0;i<p.layers.length;i++) {
            var l=p.layers[i],ours=[];
            if(l.typename==='LayerSet') {
                for(var j=0;j<l.artLayers.length;j++)if(l.artLayers[j].name==='SOCHNO_SOURCE_v1')ours.push(l);
            }
            if(l.name.indexOf('SOCHNO AUTO')===0&&ours.length)continue;
            items.push(l.id+'|'+l.visible+'|'+l.parent.name);
            if(l.typename==='LayerSet')userLayers(l,items);
        }
        return items.join('\n');
    }
    function exportPreview(d,name) {
        preview=d.duplicate('SOCHNO test export',true);preview.flatten();
        preview.convertProfile('sRGB IEC61966-2.1',Intent.RELATIVECOLORIMETRIC,true,false);
        preview.bitsPerChannel=BitsPerChannelType.EIGHT;
        preview.saveAs(File(out+'/'+name+'.png'),new PNGSaveOptions(),true,Extension.LOWERCASE);
        preview.close(SaveOptions.DONOTSAVECHANGES);preview=null;app.activeDocument=d;
    }
    function run(name) {
        var beforeDocs=app.documents.length,profile=doc.colorProfileName,depth=doc.bitsPerChannel,start=new Date().getTime();
        var r=SOCHNO.run();
        assert(r.guardPassed,name+': final quality gate');
        assert(r.outputOpacity>0,name+': must produce a visible effect');
        assert(app.documents.length===beforeDocs,name+': no temporary documents leaked');
        assert(doc.colorProfileName===profile&&doc.bitsPerChannel===depth,name+': preserve profile and depth');
        log('PASS '+name+' '+(new Date().getTime()-start)+'ms opacity='+r.outputOpacity+' tone='+r.parameters.toneGuard+' color='+r.parameters.colorGuard+' trials='+r.parameters.passes);
        return r;
    }
    var init=File(out+'/results.txt');init.open('w');init.close();
    try {
        app.displayDialogs=DialogModes.NO;app.preferences.rulerUnits=Units.PIXELS;$.global.SOCHNO_NO_AUTORUN=true;
        $.evalFile(library);
        doc=user.duplicate('SOCHNO artboard test',false);
        var collision=doc.layerSets.add();collision.name='SOCHNO AUTO | USER GROUP';var collisionId=collision.id;
        doc.selection.select([[10,10],[110,10],[110,70],[10,70]]);var selection=selectionBounds(doc);
        var originalLayers=userLayers(doc,[]);
        var r=run('layered-artboard'),groups=[];owned(doc,groups);
        assert(groups.length===1,'replace legacy output');
        assert(doc.layerSets.getByName('SOCHNO AUTO | USER GROUP').id===collisionId,'preserve lookalike user group');
        assert(selectionBounds(doc)===selection,'preserve selection');
        var resultLayers=userLayers(doc,[]);
        if(resultLayers!==originalLayers) {
            var expectedLines=originalLayers.split('\n'),actualLines=resultLayers.split('\n');
            for(var li=0;li<Math.max(expectedLines.length,actualLines.length);li++)
                if(expectedLines[li]!==actualLines[li])log('LAYER '+li+' expected '+expectedLines[li]+' actual '+actualLines[li]);
        }
        assert(resultLayers===originalLayers,'preserve all user layer order, parents and visibility');
        assert(groups[0].parent.typename==='LayerSet','result remains inside the source artboard');
        var parentCount=groups[0].parent.layers.length,state=doc.activeHistoryState;
        var again=run('repeat-artboard');groups=[];owned(doc,groups);
        assert(groups.length===1&&groups[0].parent.layers.length===parentCount,'repeat does not stack output');
        assert(Math.abs(r.before.mean-again.before.mean)<.000001,'repeat uses unprocessed source');
        assert(Math.abs(r.after.mean-again.after.mean)<.000001,'repeat produces same result');
        doc.activeHistoryState=state;groups=[];owned(doc,groups);
        assert(groups.length===1&&groups[0].id===r.groupId,'one undo restores previous output');
        // Deliberate failure after old output was hidden and a temporary document created.
        var visible=groups[0].visible,failed=false,docCount=app.documents.length;
        eval(code.replace(/^\uFEFF?#target[^\n]*/m,'').replace('var report=analyzeAndRender(tmp);',"throw Error('injected test failure');"));
        try{SOCHNO.run();}catch(expected){failed=expected.message==='injected test failure';}
        groups=[];owned(doc,groups);
        assert(failed&&groups.length===1&&groups[0].visible===visible,'failure restores prior output visibility');
        assert(app.documents.length===docCount&&app.activeDocument.id===doc.id,'failure restores document context');
        $.evalFile(library);log('PASS repeat, one-step undo, selection, lookalike group, injected rollback');
        doc.close(SaveOptions.DONOTSAVECHANGES);doc=null;
        base=user.duplicate('SOCHNO test source',false);groups=[];owned(base,groups);
        for(var i=0;i<groups.length;i++)groups[i].visible=false;
        base.flatten();
        var names=['normal','flat','dark','noisy','rgb16','grayscale'];
        for(i=0;i<names.length;i++) {
            var name=names[i];doc=base.duplicate('SOCHNO '+name,true);
            if(name==='flat') {
                var dull=doc.activeLayer.duplicate();dull.desaturate();dull.opacity=65;doc.mergeVisibleLayers();
                doc.activeLayer.adjustLevels(0,255,1,60,195);
            }
            if(name==='dark')doc.activeLayer.adjustLevels(0,255,1,0,105);
            if(name==='noisy')doc.activeLayer.applyAddNoise(9,NoiseDistribution.GAUSSIAN,true);
            if(name==='rgb16')doc.bitsPerChannel=BitsPerChannelType.SIXTEEN;
            if(name==='grayscale')doc.activeLayer.desaturate();
            var history=doc.activeHistoryState;r=run(name);
            if(name==='normal')assert(r.parameters.colorBands[4].saturation>r.parameters.colorBands[0].saturation,'boost blues more than rich reds');
            if(name==='grayscale')assert(r.parameters.colorPresence<.05&&r.after.chroma<.01,'do not colorize monochrome');
            if(name==='noisy')assert(r.parameters.noiseOpacity>0,'detect added noise');
            exportPreview(doc,name);
            doc.activeHistoryState=history;assert(doc.layerSets.length===0,'undo removes new group on flat document');
            doc.close(SaveOptions.DONOTSAVECHANGES);doc=null;
        }
        doc=base.duplicate('SOCHNO unsupported mode',true);doc.changeMode(ChangeMode.CMYK);failed=false;
        try{SOCHNO.run();}catch(expectedMode){failed=true;}
        assert(failed&&doc.layerSets.length===0,'reject unsupported color mode without mutation');
        doc.close(SaveOptions.DONOTSAVECHANGES);doc=null;log('PASS unsupported mode');
        // Force the full-size fallback search to its neutral endpoint. It must
        // blend with the original, not with a transparent/white canvas.
        doc=base.duplicate('SOCHNO fallback endpoint',true);
        var fallbackCode=code.replace(/^\uFEFF?#target[^\n]*/m,'').replace('for(var k=0;k<5;k++)','for(var k=0;k<0;k++)')
            .replace('flags.passed=!(flags.white||flags.black||flags.color||flags.saturation);','flags.passed=Math.abs(original.mean-result.mean)<.0000001;');
        eval(fallbackCode);r=SOCHNO.run();
        assert(r.guardPassed&&r.outputOpacity===0,'fallback reaches unchanged source when needed');
        assert(Math.abs(r.before.mean-r.after.mean)<.0000001&&Math.abs(r.before.chroma-r.after.chroma)<.0000001,'fallback report reflects original pixels');
        doc.close(SaveOptions.DONOTSAVECHANGES);doc=null;$.evalFile(library);log('PASS forced fallback endpoint');
        base.close(SaveOptions.DONOTSAVECHANGES);base=null;
        assert(app.documents.length===initialDocs,'all temporary test documents closed');
        log('ALL PASS Photoshop '+app.version);return 'ALL PASS: '+out.fsName;
    }catch(e){log('ERROR '+e+' line '+e.line+' file '+e.fileName);throw e;}
    finally {
        if(preview)preview.close(SaveOptions.DONOTSAVECHANGES);
        if(doc)doc.close(SaveOptions.DONOTSAVECHANGES);if(base)base.close(SaveOptions.DONOTSAVECHANGES);
        app.activeDocument=user;app.displayDialogs=dialogs;app.preferences.rulerUnits=units;$.global.SOCHNO_NO_AUTORUN=autorun;
    }
})();
