// ==UserScript==
// @name           code.woboq.org integration into Qt's gerrit
// @description    Easy access to code.woboq.org from Qt's gerrit
// @author         Olivier Goffart <ogoffart@woboq.com>
// @license        MIT
// @match          https://codereview.qt-project.org/*
// @include        https://codereview.qt-project.org/*
// @grant          none
// ==/UserScript==

(function(){
"use strict";

// Config options
var root_path = "https://code.woboq.org/qt5";
var symbol_path = "https://code.woboq.org/data/symbol.html?root=../qt5&ref=";

//-----------------------------------------------------------------------------
// Utility functions

function escapeRegExp(string) {
    return string.replace(/([.*+?^=!:${}()|\[\]\/\\])/g, "\\$1");
}

function escapeHtml(string) {
    return string.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

function unescapeHtml(string) {
    return string.replace(/&lt;/g, "<").replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"').replace(/&apos;/g, "&apos;").replace(/&amp;/g, "&");
}

function hasClass(elem, className) {
    return elem.className.split(' ').indexOf(className) > -1;
}

// Get the hash of a function for the lookup  (copied from codebrowser.js)
function getFnNameKey(request) {
    if (request.indexOf('/') != -1 || request.indexOf('.') != -1)
        return false;
    var mx = request.match(/::([^:]{2})[^:]*$/);
    if (mx)
        return mx[1].toLowerCase().replace(/[^a-z]/, '_');
    request = request.replace(/^:*/, "");
    if (request.length < 2)
        return false;
    var k = request.substr(0, 2).toLowerCase();
    return k.replace(/[^a-z]/, '_');
}

// return absolude position of a dom node (in a object with 'top' and 'left'  properties)
function getAbsolutePos(elem) {
    var left = 0;
    var top = 0;
    while (elem) {
        left += elem.offsetLeft;
        top += elem.offsetTop;
        elem = elem.offsetParent;
    }
    return {top: top,left: left};
}

//-----------------------------------------------------------------------------
// Popup

var curentFnName = ""; // the fnName for which the popup is shown or that we are trying to load
var currentXmlHttpRequest = null;

function closePopup() {
    curentFnName = "";
    if (currentXmlHttpRequest)
        currentXmlHttpRequest.abort();
    var popup = document.getElementById('woboq_popup');
    if (popup && popup.hasChildNodes())
        popup.removeChild(popup.childNodes[0]);
}

function showRefPopup(ref, pos, fnName) {
    curentFnName = fnName;
    var xhr = new XMLHttpRequest();
    xhr.open('GET', root_path + "/refs/" + ref);
    xhr.onload = function() {
        if (xhr.status !== 200)
            return;
        if (curentFnName !== fnName)
            return;
        var xml = (new window.DOMParser()).parseFromString(
                    "<data>"+xhr.responseText+"</data>", "text/xml");
        if (!xml || !xml.childNodes || !xml.childNodes[0] || !xml.childNodes[0].childNodes)
            return;

        var type = "";
        var url = "";
        var defList = [];
        var useCount = 0;

        var nodes = xml.childNodes[0].childNodes;
        for (var i = 0; i < nodes.length; ++i) {
            var n = nodes[i];
            if (!n || !n.tagName) continue;
            if (n.tagName === "def") {
                if (!type && n.hasAttribute("type")) {
                    type = n.getAttribute("type");
                }
                if (!url && n.hasAttribute("f")) {
                    url = root_path + "/" + n.getAttribute("f") + ".html#" + ref;
                }
            } else if (n.tagName === "use") {
                useCount++;
            }
        }

        if (url && type) {
            var popup = document.getElementById('woboq_popup');
            if (!popup) {
                popup = document.createElement('div');
                popup.id = 'woboq_popup';
                document.body.appendChild(popup);
            }
            var html = "<div style='"
                +"padding:1em; padding-top:1ex; border: 1px solid gray; background-color: white;"
                +"font-size: smaller; opacity: 0.9; border-radius: 4px;"
                +"max-width: 80%; box-shadow:1px 1px 7px gray; z-index:2;"
                +"position: absolute;"
                +"top:" + (pos.top + 20) + "px;"
                +"left:"+ pos.left +"px;"
                +"'>";

            html += "<p style='color:#061'>" + escapeHtml(type) + "</p>";
            html += "<p><a style='color:#037' href='" + escapeHtml(url) + "'>Go to definition</a>";

            html += "<br /><a style='color:#037' href='" + escapeHtml(symbol_path + ref)
                + "#uses'>Show uses (" + useCount + ")</a></p>";
            html += "</div>";
            popup.innerHTML = html;
        }
    };
    xhr.send();
    currentXmlHttpRequest = xhr;
}

// hovering ofer 'elem' node that contains a path to 'file'
function hoverFile(elem, file) {
    elem.woboq_done = true;
    var xhr = new XMLHttpRequest();
    xhr.open('GET', root_path + "/fileIndex");
    xhr.onload = function() {
        var possible_files = [];
        if (xhr.status === 200) {
            var allFiles = xhr.responseText.split("\n");
            for (var i = 0; i < allFiles.length; ++i) {
                if (allFiles[i].indexOf(file) >= 0)
                    possible_files.push(allFiles[i]);
            }
        }
        possible_files.sort(function(a, b) { return a.length - b.length; });
        if (possible_files.length > 0) {
            elem.innerHTML = "<a style='"
                + "color:inherit;"
//                + "background-image: url(https://woboq.com/favicon.ico);"
//                + "background-position: right;"
//                + "background-repeat: no-repeat;"
//                + "padding-right: 20px;"
                + "' href='" + root_path + "/"+ escapeHtml(possible_files[0]) +".html'>"
                + elem.innerHTML + "</a>";
        }
    };
    xhr.send();
}

//helper regexp to find the def in the index
var findDefRx = new RegExp("<def f='([^']*)' l='(\\d*)'(?: type='([^']*)')?[^/]*/>");

//-----------------------------------------------------------------------------
document.addEventListener('mouseover', function (event) {
    if (event.target.woboq_done)
        return;
    if (hasClass(event.target, 'diffTextFileHeader')) {
        // Possile file name in a unified diff
        var words = event.target.textContent.split(' ');
        var file = "";
        for (var i = 0; i < words.length; ++i) {
            if (words[i].match(/^[ab]\/.*/))
                file = words[i].substr(2).trim();
        }
        if (file.length > 0) {
            hoverFile(event.target, file);
        }
    } else if (hasClass(event.target, 'diffFileName') || hasClass(event.target, 'gwt-InlineLabel')) {
        // file name
        hoverFile(event.target, event.target.textContent);
    } else if (event.target.tagName === "LI" && event.target.hasAttribute("data-ref")) {
        // Hovering over an entry in out popup: fetch from the index to add a link
        var ref = event.target.getAttribute("data-ref");
        var xhr = new XMLHttpRequest();
        xhr.open('GET', root_path + "/refs/" + ref);
        xhr.onload = function() {
            if (xhr.status !== 200)
                return;
            var mx = xhr.responseText.match(findDefRx);
            if (mx) {
                var proj = root_path.replace(/^.*\/([^\/]*)/, "$1");
                var url = root_path + "/" + escapeHtml(mx[1]) + ".html#" + ref;
                var html = "<a style='color:inherit' href='" + url + "'";
                if (mx[3]) // mx[3] is already xml escaped, but re-do the escaping in case it's not
                    html += " title='" + escapeHtml(unescapeHtml(mx[3])) + "'";
                html += ">" + event.target.innerHTML + "</a>";
                event.target.innerHTML = html;
            }
        };
        xhr.send();
    }
}, false );




var woboq_previousMouseMove = "";
document.addEventListener( 'mousemove', function (event) {
    if (event.target.tagName == "body" || event.target == woboq_previousMouseMove)
        return;
    woboq_previousMouseMove = event.target;
    console.log("MOVE LISTENER ->" + event.target.tagName);

    function getHitWord(hit_elem) {
        var hit_word = '';
        hit_elem = $(hit_elem);

        //text contents of hit element
        var text_nodes = hit_elem.contents().filter(function(){
            return this.nodeType == Node.TEXT_NODE && this.nodeValue.match(/[a-zA-Z:_]{2,}/)
        });
        console.log(text_nodes);

        //bunch of text under cursor? break it into words
        if (text_nodes.length > 0) {
            var original_content = hit_elem.clone();

            //wrap every word in every node in a dom element
            text_nodes.replaceWith(function(i) {
                return $(this).text().replace(/([a-zA-Z-:_]*)/g, "<word>$1</word>")
            });
            console.log(text_nodes);

            //get the exact word under cursor
            var hit_word_elem = document.elementFromPoint(event.clientX, event.clientY);

            if (hit_word_elem.nodeName != 'WORD') {
                console.log("missed!");
            }
            else  {
                hit_word = $(hit_word_elem).text();
                console.log("got it: "+hit_word);
            }

            hit_elem.replaceWith(original_content);
        }

        return hit_word;
    }

    var hit_word = getHitWord(document.elementFromPoint(event.clientX, event.clientY));
    console.log("WORD LISTENER ->" + hit_word);


    // Ignore clicks on the popup
    var parent = event.target;
    if (!parent)return;
    while (parent) {
        if (parent.id === "woboq_popup")
            return;
        parent = parent.parentNode;
    }

    //var selection = window.getSelection();
    //var target = selection.anchorNode;
    //if (target !== selection.focusNode)
    //    return closePopup();  // only do the matching if the selection is in one line
    // if (!hasClass( target.parentNode, 'diffText')
    //         && !hasClass( target.parentNode.parentNode, 'diffText')
    //         && !hasClass( target.parentNode.parentNode.parentNode, 'diffText')
    //         && !hasClass( target.parentNode, 'fileLine')
    //         && !hasClass( target.parentNode.parentNode, 'fileLine')
    //         && !hasClass( target.parentNode.parentNode.parentNode, 'fileLine'))
    //     return closePopup();  // not part of the diff

    //var data = ""+target.data;
    var data = hit_word;
    if (data.length < 2)
        return closePopup();
    // var begin = Math.min(selection.anchorOffset, selection.focusOffset);
    // var end = Math.max(selection.anchorOffset, selection.focusOffset);
    // // extend the selection to the beginning of the token
    // while(begin > 0 && data[begin-1].match((/[a-zA-Z0-9_:]/)))
    //     begin--;
    // while(end < data.length && data[end].match((/[a-zA-Z0-9_:]/)))
    //     end++;

    //var fnName = data.substr(begin, end-begin);
    var fnName = data;

    //extend the selection to the begining of the token if it is in another html node
    // var node = target.parentNode.previousSibling;
    // if (!node) node = target.parentNode.parentNode.previousSibling;
    // while (begin === 0 && node) {
    //     data = node.innerText;
    //     if (!data)
    //         break;
    //     begin = data.length;
    //     while(begin > 0 && data[begin-1].match((/[a-zA-Z0-9_:]/)))
    //         begin--;
    //     fnName = data.substr(begin) + fnName;
    //     node = node.previousSibling;
    // }
    //and to the end
    // node = target.parentNode.nextSibling;
    // if (!node) node = target.parentNode.parentNode.nextSibling;
    // data = ""+target.data;
    // while (end === data.length && node) {
    //     data = node.innerText;
    //     if (!data)
    //         break;
    //     end = 0;
    //     while(end < data.length && data[end].match((/[a-zA-Z0-9_:]/)))
    //         end++;
    //     fnName = fnName + data.substr(0, end);
    //     node = node.nextSibling;
    // }

    if (fnName === curentFnName) {
        return; // popup already there
    } else {
        closePopup();
    }

    if (fnName.match(/[^a-zA-Z0-9_:]/))
        return;

    var k = getFnNameKey(fnName);
    if (!k)
        return;
    curentFnName = fnName;
    var xhr = new XMLHttpRequest();
    xhr.open('GET', root_path + "/fnSearch/" + k);
    xhr.onload = function() {
        if (curentFnName !== fnName)
            return;

        if (xhr.status !== 200)
            return;

        var possibilities = [];
        var rx = new RegExp("(\\||::)"+ escapeRegExp(fnName) + "(\\(|$)", '');
        var lines = xhr.responseText.split("\n").filter(function(line) { return line.match(rx); });
        for (var i = 0; i < lines.length; ++i) {
            var parsed = lines[i].split('|');
            possibilities.push({ name:parsed[1], ref:parsed[0] });
        }
        if (possibilities.length > 1) {
            // Several possibilities, show a choice menu
            var popup = document.getElementById('woboq_popup');
            if (!popup) {
                popup = document.createElement('div');
                popup.id = 'woboq_popup';
                document.body.appendChild(popup);
            }
            //var pos = getAbsolutePos(target.parentNode);
            var pos = getAbsolutePos(woboq_previousMouseMove.parentNode);
            var html = "<div style='"
                +"padding:1em; padding-top:1ex; border: 1px solid gray; background-color: white;"
                +"font-size: smaller; opacity: 0.9; border-radius: 4px;"
                +"max-width: 80%; box-shadow:1px 1px 7px gray; z-index:2;"
                +"overflow-y:auto; max-height: 300px;"
                +"position: absolute;"
                +"top:" + (pos.top + 20) + "px;"
                +"left:"+ pos.left +"px;"
                +"'><ul style='margin:0; padding:0'>";

            for(var i = 0; i < possibilities.length; ++i) {
                html += "<li data-ref='" + escapeHtml(possibilities[i].ref) + "'>"
                    + escapeHtml(possibilities[i].name) +"</i>";
            }
            html += "</ul></div>";
            popup.innerHTML = html;
        } else if (possibilities.length == 1) {
            //showRefPopup(possibilities[0].ref, getAbsolutePos(target.parentNode), fnName);
            showRefPopup(possibilities[0].ref, getAbsolutePos(woboq_previousMouseMove.parentNode), fnName);
        }
    };
    xhr.send();
    currentXmlHttpRequest = xhr;

}, false );

window.addEventListener('hashchange', closePopup);


})();
