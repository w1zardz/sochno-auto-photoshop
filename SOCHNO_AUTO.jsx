#target photoshop
/* SOCHNO AUTO 1.1 | Adaptive color grading and thumbnail finishing for Photoshop.
   Local, self-contained ExtendScript. RGB 8/16-bit. No network or paid plugins.
   One run = one undo step. Regenerates its own group from the unprocessed source.
   Copyright 2026. You may use and modify this script for any of your projects. */
var SOCHNO = (function () {
    var api = {}, C = charIDToTypeID, S = stringIDToTypeID;
    var PREFIX = 'SOCHNO AUTO', MARKER = 'SOCHNO_SOURCE_v1';
    function clamp(x,a,b) { return Math.max(a,Math.min(b,x)); }
    function round(x) { return Math.round(x); }
    function hue(c,mx,mn) {
        var delta=mx-mn;if(delta<.00001)return 0;
        // ExtendScript associates chained conditional expressions differently from modern JS.
        var h;
        if(mx===c[0])h=(c[1]-c[2])/delta;
        else if(mx===c[1])h=2+(c[2]-c[0])/delta;
        else h=4+(c[0]-c[1])/delta;
        return (h*60+360)%360;
    }
    function activeRGB(d) { app.activeDocument=d; d.activeChannels=d.componentChannels; }
    function close(d) { if(d) { try { d.close(SaveOptions.DONOTSAVECHANGES); } catch(e) {} } }
    function q(hist,n,p) { var s=0; for(var i=0;i<256;i++) {s+=hist[i]; if(s>=n*p)return i/255;} return 1; }
    function isOurs(g) {
        if(g.typename!=='LayerSet' || g.name.indexOf(PREFIX)!==0)return false;
        for(var i=0;i<g.artLayers.length;i++)if(g.artLayers[i].name===MARKER)return true;
        return false;
    }
    function findOurs(parent,arr) {
        for(var i=0;i<parent.layerSets.length;i++) {
            var g=parent.layerSets[i];
            if(isOurs(g))arr.push({layer:g,id:g.id,visible:g.visible}); else findOurs(g,arr);
        }
    }
    function findNamedGroup(parent,name) {
        for(var i=0;i<parent.layerSets.length;i++) {
            var g=parent.layerSets[i];if(g.name===name)return g;
            var found=findNamedGroup(g,name);if(found)return found;
        }
        return null;
    }
    function selectLayerId(doc,id) {
        app.activeDocument=doc;var d=new ActionDescriptor(),r=new ActionReference();
        r.putIdentifier(C('Lyr '),id);d.putReference(C('null'),r);d.putBoolean(C('MkVs'),false);
        executeAction(C('slct'),d,DialogModes.NO);return doc.activeLayer;
    }
    function deleteLayerId(id) {
        var d=new ActionDescriptor(),r=new ActionReference();r.putIdentifier(C('Lyr '),id);d.putReference(C('null'),r);
        executeAction(C('Dlt '),d,DialogModes.NO);
    }
    function isArtboard(l) {
        if(l.typename!=='LayerSet')return false;
        var r=new ActionReference(); r.putIdentifier(C('Lyr '),l.id);
        var d=executeActionGet(r);
        return d.hasKey(S('artboardEnabled')) && d.getBoolean(S('artboardEnabled'));
    }
    // Read a temporary 24-bit BMP; avoids thousands of slow Photoshop color samplers.
    function pixels(doc,maxSide) {
        var t=null, file=File(Folder.temp+'/sochno_'+new Date().getTime()+'_'+round(Math.random()*1e8)+'.bmp');
        try {
            t=doc.duplicate('SOCHNO analysis',true); activeRGB(t); t.selection.deselect();
            t.flatten();
            if(t.colorProfileName!=='sRGB IEC61966-2.1')t.convertProfile('sRGB IEC61966-2.1',Intent.RELATIVECOLORIMETRIC,true,false);
            t.bitsPerChannel=BitsPerChannelType.EIGHT;
            var scale=Math.min(1,maxSide/Math.max(t.width.as('px'),t.height.as('px')));
            if(scale<1)t.resizeImage(UnitValue(round(t.width.as('px')*scale),'px'),UnitValue(round(t.height.as('px')*scale),'px'),null,ResampleMethod.BICUBIC);
            var options=new BMPSaveOptions(); options.depth=BMPDepthType.TWENTYFOUR;
            options.alphaChannels=false; options.rleCompression=false;
            t.saveAs(file,options,true,Extension.LOWERCASE);
            file.encoding='BINARY'; if(!file.open('r'))throw Error('Не удалось прочитать временный анализ.');
            var data=file.read(); file.close();
            function u16(n) {return data.charCodeAt(n)+(data.charCodeAt(n+1)<<8);}
            function u32(n) {return (data.charCodeAt(n)+(data.charCodeAt(n+1)<<8)+(data.charCodeAt(n+2)<<16)+data.charCodeAt(n+3)*16777216);}
            var off=u32(10),w=u32(18),rawH=u32(22),h=rawH>2147483647?4294967296-rawH:rawH;
            if(data.substr(0,2)!=='BM'||u16(28)!==24||u32(30)!==0||!w||!h)throw Error('Неподдерживаемый формат анализа BMP.');
            var stride=Math.floor((w*3+3)/4)*4,arr=new Array(w*h),ys=new Array(w*h);
            if(off+stride*h>data.length)throw Error('Неполный файл анализа.');
            for(var y=0;y<h;y++)for(var x=0;x<w;x++) {
                var p=off+(rawH>2147483647?y:h-1-y)*stride+x*3;
                var b=data.charCodeAt(p)/255,g=data.charCodeAt(p+1)/255,r=data.charCodeAt(p+2)/255;
                arr[y*w+x]=[r,g,b]; ys[y*w+x]=.2126*r+.7152*g+.0722*b;
            }
            return {rgb:arr,y:ys,w:w,h:h};
        } finally {try{file.close();file.remove();}catch(e){} close(t); app.activeDocument=doc;}
    }
    function stats(px) {
        var n=px.rgb.length,h=[],sum=0,sat=0,hot=0,white=0,black=0,colorClip=0,shadow=0,light=0,edge=0,ec=0,res=[],resCount=0;
        var bands=[],neutral=[0,0,0],neutralN=0,chroma=0;
        for(var bi=0;bi<6;bi++)bands.push({count:0,saturation:0,hot:0,clip:0});
        for(var i=0;i<256;i++)h[i]=0;
        for(i=0;i<n;i++) {
            var c=px.rgb[i],y=px.y[i],mx=Math.max(c[0],c[1],c[2]),mn=Math.min(c[0],c[1],c[2]);
            var s=mx>0?(mx-mn)/mx:0;
            chroma+=mx-mn;
            if(s>.12&&y>.06&&y<.94) {
                var band=bands[Math.floor((hue(c,mx,mn)+30)/60)%6];
                band.count++;band.saturation+=s;
                if(s>.9)band.hot++;
                if(mx>=.995)band.clip++;
            }
            // Conservative neutral candidates only; colored scenery is not a white reference.
            if(s<.16&&y>.25&&y<.85) {
                for(var ci=0;ci<3;ci++)neutral[ci]+=c[ci]-y;
                neutralN++;
            }
            h[clamp(round(y*255),0,255)]++;sum+=y;sat+=s;
            if(s>.9&&y>.06)hot++;
            if(mn>=.985)white++;
            if(mx<=.015)black++;
            if(mx>=.995&&s>.25)colorClip++;
            if(y>.015&&y<.25)shadow++;
            if(y>.84&&y<.985)light++;
            var xx=i%px.w,yy=Math.floor(i/px.w);
            if(xx>1&&yy>1&&xx<px.w-2&&yy<px.h-2) {
                var l=px.y[i-1],r=px.y[i+1],u=px.y[i-px.w],d=px.y[i+px.w];
                edge+=Math.abs(y-r)+Math.abs(y-d);ec+=2;
                var range=Math.max(l,r,u,d)-Math.min(l,r,u,d);
                if(range<.055&&y>.05&&y<.9)res[resCount++]=Math.abs(y-(l+r+u+d)/4);
            }
        }
        res.sort(function(a,b){return a-b;});
        for(bi=0;bi<6;bi++) {
            var b=bands[bi],bn=Math.max(1,b.count);
            b.saturation/=bn;b.hot/=bn;b.clip/=bn;b.share=b.count/n;
        }
        for(ci=0;ci<3;ci++)neutral[ci]/=Math.max(1,neutralN);
        return {mean:sum/n,median:q(h,n,.5),p05:q(h,n,.05),p10:q(h,n,.1),p90:q(h,n,.9),p95:q(h,n,.95),
            saturation:sat/n,hot:hot/n,white:white/n,black:black/n,colorClip:colorClip/n,shadows:shadow/n,highlights:light/n,
            edge:ec?edge/ec:0,noise:res.length>50?res[Math.floor(res.length*.65)]:0,noiseSamples:res.length,
            bands:bands,neutral:neutral,neutralShare:neutralN/n,chroma:chroma/n};
    }
    function decide(s,width) {
        var flat=clamp((.72-(s.p90-s.p10))/.5,0,1),rich=clamp((s.saturation-.32)/.4,0,1);
        var noisy=clamp((s.noise-.004)/.020,0,1),detailed=clamp((s.edge-.045)/.08,0,1);
        var densityProtection=rich*clamp((s.mean-.24)/.15,0,1);
        var colorPresence=clamp((s.chroma-.008)/.055,0,1);
        var colorBands=[],hueShift=[0,-3,1,3,-2,0],density=[-1,-2,-4,-7,-6,-2];
        for(var i=0;i<6;i++) {
            var b=s.bands[i],headroom=clamp((.88-b.saturation)/.65,0,1);
            // Reds include skin and need a gentler boost; never shift their hue.
            var boost=(i===0?5:12)+(i===0?10:24)*headroom-b.hot*7-b.clip*6;
            colorBands.push({hue:hueShift[i]*colorPresence,
                saturation:round(clamp(boost,0,32)*colorPresence),
                lightness:round(density[i]*colorPresence*(.65+.35*rich)),guard:1});
        }
        var neutralConfidence=clamp((s.neutralShare-.025)/.12,0,1);
        return {
            // Colorful artwork often has intentionally dark UI/backgrounds: do not wash them out.
            lift:clamp((.57-s.mean)*100,-14,32)*(1-densityProtection*.4),contrast:17+flat*22,
            shadows:round(clamp(8+s.shadows*35+(s.mean<.33?8:0),6,30)*(1-densityProtection*.2)),
            highlights:round(clamp(s.highlights*38,0,12)),
            vibrance:round(clamp(82-rich*22-s.hot*16,30,82)*colorPresence),
            saturation:round(clamp(12-rich*7-s.hot*6,1,12)*colorPresence),
            colorBands:colorBands,
            balance:[clamp(-s.neutral[0]*180,-6,6)*neutralConfidence,
                clamp(-s.neutral[1]*180,-6,6)*neutralConfidence,
                clamp(-s.neutral[2]*180,-6,6)*neutralConfidence],
            colorPresence:colorPresence,
            clarity:round((31+flat*16-detailed*10)*(1-noisy*.45)),
            texture:round((19+flat*12)*(1-noisy*.65)),
            sharp:round((96-detailed*32)*(1-noisy*.55)),
            threshold:round(2+noisy*5),noiseOpacity:noisy>.35?round(12+noisy*20):0,
            scale:clamp(width/1280,.25,6),toneGuard:1,detailGuard:1,colorGuard:1,gradeGuard:1,passes:0
        };
    }
    function curvePoints(p) {
        var xs=[0,16,48,96,128,176,224,248,255],out=[],last=-1;
        var L=p.lift*p.toneGuard,K=p.contrast*p.toneGuard;
        var ys=[0,16-K*.23,48+L*.55-K*.6,96+L*.9-K*.3,128+L,176+L*.48+K,224+L*.08+K*.15,248,255];
        for(var i=0;i<xs.length;i++){var v=clamp(round(ys[i]),last+1,255-(xs.length-1-i));out.push([xs[i],v]);last=v;}
        return out;
    }
    function adjustment(name,type,settings) {
        var d=new ActionDescriptor(),r=new ActionReference(),u=new ActionDescriptor();
        r.putClass(S('adjustmentLayer')); d.putReference(C('null'),r);u.putString(C('Nm  '),name);
        u.putObject(C('Type'),type,settings);d.putObject(C('Usng'),S('adjustmentLayer'),u);
        executeAction(C('Mk  '),d,DialogModes.NO);return app.activeDocument.activeLayer;
    }
    function curves(p) {
        var d=new ActionDescriptor(),a=new ActionList(),ch=new ActionDescriptor(),r=new ActionReference(),pts=new ActionList();
        r.putEnumerated(C('Chnl'),C('Chnl'),C('Cmps'));ch.putReference(C('Chnl'),r);
        var points=curvePoints(p);
        for(var i=0;i<points.length;i++){var pt=new ActionDescriptor();pt.putDouble(C('Hrzn'),points[i][0]);pt.putDouble(C('Vrtc'),points[i][1]);pts.putObject(C('Pnt '),pt);}
        ch.putList(C('Crv '),pts);a.putObject(C('CrvA'),ch);d.putList(C('Adjs'),a);
        var layer=adjustment('03 | СВЕТ + КОНТРАСТ · AUTO',C('Crvs'),d);layer.blendMode=BlendMode.LUMINOSITY;
        return layer;
    }
    function vibrance(p) {
        var d=new ActionDescriptor();d.putInteger(S('vibrance'),round(p.vibrance*p.colorGuard));d.putInteger(S('saturation'),round(p.saturation*p.colorGuard));
        var l=adjustment('06 | СОЧНОСТЬ · AUTO '+round(p.vibrance*p.colorGuard),S('vibrance'),d);l.blendMode=BlendMode.COLORBLEND;return l;
    }
    function colorBalance(p) {
        var d=new ActionDescriptor();
        var split=5*p.colorPresence*p.gradeGuard;
        var values=[[-split,0,split],[p.balance[0]*p.gradeGuard,p.balance[1]*p.gradeGuard,p.balance[2]*p.gradeGuard],[split,0,-split]];
        var keys=['ShdL','MdtL','HghL'];
        for(var i=0;i<3;i++) {
            var list=new ActionList();for(var j=0;j<3;j++)list.putInteger(round(values[i][j]));
            d.putList(C(keys[i]),list);
        }
        d.putBoolean(C('PrsL'),true);
        var l=adjustment('04 | ЦВЕТОБАЛАНС · ТЁПЛЫЙ СВЕТ / ХОЛОДНЫЕ ТЕНИ',C('ClrB'),d);
        l.blendMode=BlendMode.COLORBLEND;return l;
    }
    function colorSeparation(p) {
        var d=new ActionDescriptor(),list=new ActionList();
        d.putEnumerated(S('presetKind'),S('presetKindType'),S('presetKindCustom'));
        for(var i=0;i<6;i++) {
            var b=p.colorBands[i],row=new ActionDescriptor(),center=i*60;
            row.putInteger(S('localRange'),i+1);
            row.putInteger(S('beginRamp'),(center+315)%360);row.putInteger(S('beginSustain'),(center+345)%360);
            row.putInteger(S('endSustain'),(center+15)%360);row.putInteger(S('endRamp'),(center+45)%360);
            row.putInteger(S('hue'),round(b.hue*p.gradeGuard));
            row.putInteger(S('saturation'),round(b.saturation*b.guard*p.gradeGuard));
            row.putInteger(S('lightness'),round(b.lightness*p.gradeGuard));
            list.putObject(S('hueSatAdjustmentV2'),row);
        }
        d.putList(S('adjustment'),list);
        // Normal blending intentionally retains small per-color density changes.
        return adjustment('05 | ГЛУБИНА ЦВЕТА · 6 ДИАПАЗОНОВ',S('hueSaturation'),d);
    }
    function smart() {executeAction(S('newPlacedLayer'),undefined,DialogModes.NO);return app.activeDocument.activeLayer;}
    function usm(amount,radius,threshold) {
        var d=new ActionDescriptor();d.putUnitDouble(C('Amnt'),C('#Prc'),amount);d.putUnitDouble(C('Rds '),C('#Pxl'),radius);d.putInteger(C('Thsh'),threshold);
        executeAction(C('UnsM'),d,DialogModes.NO);
    }
    function render(doc,p) {
        activeRGB(doc);doc.selection.deselect();
        var source=doc.activeLayer;source.name=MARKER;
        var group=doc.layerSets.add();group.name=PREFIX+' | ЖЁСТКИЙ АВТОФИНИШ';group.blendMode=BlendMode.NORMAL;
        source.move(group,ElementPlacement.INSIDE);doc.activeLayer=source;
        source=smart();source.name=MARKER;
        var base=source;
        if(p.noiseOpacity>0) {
            var smooth=source.duplicate();doc.activeLayer=smooth;
            executeAction(C('Mdn '),(function(){var d=new ActionDescriptor();d.putUnitDouble(C('Rds '),C('#Pxl'),1);return d;})(),DialogModes.NO);
            smooth.name='00 | МЯГКОЕ ПОДАВЛЕНИЕ ШУМА';smooth.opacity=p.noiseOpacity;smooth.blendMode=BlendMode.LUMINOSITY;
            // Keep the original marker, but use a rendered composite for subsequent detail passes.
            var temp=doc.duplicate('SOCHNO denoise merge',true);
            var merged=temp.activeLayer.duplicate(doc,ElementPlacement.PLACEATBEGINNING);close(temp);activeRGB(doc);
            merged.move(group,ElementPlacement.INSIDE);doc.activeLayer=merged;base=smart();base.name='01 | БАЗА ПОСЛЕ ШУМА';
        }
        // Local tonal recovery, with no black/white percentile clipping.
        doc.activeLayer=base;
        base.shadowHighlight(round(p.shadows*p.toneGuard),38,round(32*p.scale),round(p.highlights*p.toneGuard),24,round(28*p.scale),0,0,0,0);
        // Separate Luminosity layer prevents colored halos in high-contrast graphics.
        var detail=base.duplicate();doc.activeLayer=detail;detail.name='02 | ОБЪЁМ + ТЕКСТУРА + ЧЁТКОСТЬ · AUTO';detail.blendMode=BlendMode.LUMINOSITY;
        usm(round(p.clarity*p.detailGuard),clamp(18*p.scale,3,100),p.threshold);
        usm(round(p.texture*p.detailGuard),clamp(2.2*p.scale,.6,12),p.threshold);
        usm(round(p.sharp*p.detailGuard),clamp(.65*p.scale,.35,2.5),p.threshold);
        var tone=curves(p);tone.move(group,ElementPlacement.INSIDE);
        doc.activeLayer=tone;var balance=colorBalance(p);balance.move(group,ElementPlacement.INSIDE);
        doc.activeLayer=balance;var palette=colorSeparation(p);palette.move(group,ElementPlacement.INSIDE);
        doc.activeLayer=palette;var color=vibrance(p);color.move(group,ElementPlacement.INSIDE);
        doc.activeLayer=group;return group;
    }
    function quality(original,result) {
        var flags={white:result.white>original.white+.018,black:result.black>original.black+.015,
            color:result.colorClip>original.colorClip+.065,saturation:result.hot>original.hot+.12,bands:[],passed:true};
        for(var i=0;i<6;i++) {
            var before=original.bands[i],after=result.bands[i];
            // Compare occupied image area, avoiding unstable percentages for rare colors.
            var bad=before.share>.025 && (after.hot*after.share>before.hot*before.share+.035 ||
                after.clip*after.share>before.clip*before.share+.025);
            flags.bands.push(bad);
        }
        flags.passed=!(flags.white||flags.black||flags.color||flags.saturation);
        for(i=0;i<6;i++)if(flags.bands[i])flags.passed=false;
        return flags;
    }
    function reduce(p,flags) {
        if(flags.white||flags.black){p.toneGuard*=.72;p.detailGuard*=.72;}
        if(flags.color||flags.saturation)p.colorGuard*=.65;
        var bandFailed=false;
        for(var i=0;i<6;i++)if(flags.bands[i]){p.colorBands[i].guard*=.55;bandFailed=true;}
        // A failing hue can still be driven by global Vibrance. Keep tonal detail intact.
        if(bandFailed&&!flags.color&&!flags.saturation)p.colorGuard*=.78;
        if(flags.color||flags.saturation||bandFailed)p.gradeGuard*=.82;
    }
    function analyzeAndRender(merged) {
        var original=stats(pixels(merged,128));
        // Estimate noise from full-size high-frequency luminance, not from a tiny
        // thumbnail where letters and textures can be mistaken for noise.
        var noiseDoc=null;
        try {
            noiseDoc=merged.duplicate('SOCHNO noise analysis',true);activeRGB(noiseDoc);
            noiseDoc.bitsPerChannel=BitsPerChannelType.EIGHT;
            noiseDoc.activeLayer.applyHighPass(clamp(.6*merged.width.as('px')/1280,.5,3));
            var hist=noiseDoc.histogram,total=0;
            for(var ni=0;ni<hist.length;ni++)total+=hist[ni];
            original.noise=(q(hist,total,.75)-q(hist,total,.25))/2;
        } finally {close(noiseDoc);app.activeDocument=merged;}
        var p=decide(original,merged.width.as('px'));
        var trial=null,result,accepted=false,flags;
        // Evaluate actual Photoshop rendering, not just the intended slider values.
        for(var k=0;k<5;k++) {
            try {
                trial=merged.duplicate('SOCHNO quality check',true);activeRGB(trial);
                var ratio=Math.min(1,640/Math.max(trial.width.as('px'),trial.height.as('px')));
                if(ratio<1)trial.resizeImage(UnitValue(round(trial.width.as('px')*ratio),'px'),UnitValue(round(trial.height.as('px')*ratio),'px'),null,ResampleMethod.BICUBIC);
                // Compare at the same preview scale; resizing alone can change clipping counts.
                var previewOriginal=stats(pixels(trial,128));
                var fullScale=p.scale;
                try {p.scale=fullScale*ratio;render(trial,p);} finally {p.scale=fullScale;}
                result=stats(pixels(trial,128));p.passes=k+1;
                flags=quality(previewOriginal,result);
                if(flags.passed){accepted=true;break;}
                if(k<4)reduce(p,flags);
            } finally {close(trial);trial=null;app.activeDocument=merged;}
        }
        var finalSource=merged.activeLayer;
        finalSource.duplicate();merged.activeLayer=finalSource;
        var group=render(merged,p);
        // Check the final full-size render too. If the limited search cannot pass,
        // blend toward the original and verify each fallback rather than silently shipping a failure.
        result=stats(pixels(merged,128));flags=quality(original,result);accepted=flags.passed;
        var opacity=100;
        while(!accepted&&opacity>0) {
            opacity=Math.max(0,opacity-20);group.opacity=opacity;
            result=stats(pixels(merged,128));flags=quality(original,result);accepted=flags.passed;
        }
        group.name=PREFIX+' 1.1 | ЦВЕТ + ОБЪЁМ · '+opacity+'%';
        return {group:group,before:original,after:result,parameters:p,guardPassed:accepted,outputOpacity:opacity};
    }
    api.lastReport=null;
    api.run=function () {
        if(!app.documents.length)throw Error('Открой превью в Photoshop и снова запусти SOCHNO AUTO.');
        var src=app.activeDocument;
        if(src.mode!==DocumentMode.RGB || (src.bitsPerChannel!==BitsPerChannelType.EIGHT && src.bitsPerChannel!==BitsPerChannelType.SIXTEEN))
            throw Error('Для превью нужен режим RGB, 8 или 16 бит: Изображение → Режим.');
        var count=0,parent=src;
        for(var a=0;a<src.layerSets.length;a++)if(isArtboard(src.layerSets[a])){count++;parent=src.layerSets[a];}
        if(count>1)throw Error('Запусти на отдельном превью: в документе несколько монтажных областей.');
        var oldDialogs=app.displayDialogs,oldUnits=app.preferences.rulerUnits,oldState=src.activeHistoryState;
        var tmp=null;
        var work=function () {
            var prev=[];findOurs(src,prev);
            for(var i=0;i<prev.length;i++)prev[i].layer.visible=false;
            tmp=src.duplicate('SOCHNO processing',true);activeRGB(tmp);tmp.selection.deselect();
            var report=analyzeAndRender(tmp);
            var finalName=report.group.name,transferName=PREFIX+' transfer '+new Date().getTime()+' '+round(Math.random()*1e8);
            report.group.name=transferName;
            app.activeDocument=src;if(parent!==src)selectLayerId(src,parent.layers[0].id);
            app.activeDocument=tmp;
            report.group.duplicate(src,ElementPlacement.PLACEATBEGINNING);
            app.activeDocument=src;
            // The DOM object returned by cross-document duplicate can resolve to an
            // unrelated layer in a complex artboard. Re-find the tagged group, then
            // use stable layer IDs for selection and deletion after collection changes.
            var output=findNamedGroup(src,transferName);
            if(!output)throw Error('Не удалось найти перенесённую группу обработки.');
            var outputId=output.id;
            if(parent!==src && (output.parent.typename!=='LayerSet'||output.parent.id!==parent.id))
                throw Error('Не удалось поместить результат в исходную монтажную область.');
            // Only replace groups created by this script and bearing its source marker.
            for(i=prev.length-1;i>=0;i--)deleteLayerId(prev[i].id);
            output=selectLayerId(src,outputId);output.visible=true;output.name=finalName;activeRGB(src);
            api.lastReport={version:api.version,before:report.before,after:report.after,parameters:report.parameters,guardPassed:report.guardPassed,outputOpacity:report.outputOpacity,groupId:outputId};
        };
        try {
            app.displayDialogs=DialogModes.NO;app.preferences.rulerUnits=Units.PIXELS;
            $.global.SOCHNO_INTERNAL_WORK=work;
            src.suspendHistory('SOCHNO AUTO — обработать превью','SOCHNO_INTERNAL_WORK()');
            return api.lastReport;
        } catch(e) {
            close(tmp);tmp=null;app.activeDocument=src;
            try{src.activeHistoryState=oldState;}catch(rollback){}
            throw e;
        } finally {
            close(tmp);app.activeDocument=src;app.displayDialogs=oldDialogs;app.preferences.rulerUnits=oldUnits;
            $.global.SOCHNO_INTERNAL_WORK=undefined;
        }
    };
    api.analyze=function(doc){return stats(pixels(doc,128));};
    api.decide=decide;
    api.version='1.1.0';
    return api;
})();
if(!$.global.SOCHNO_NO_AUTORUN) {
    try {SOCHNO.run();} catch(e) {alert('SOCHNO AUTO\n\n'+e.message+'\nСтрока: '+e.line);}
}
