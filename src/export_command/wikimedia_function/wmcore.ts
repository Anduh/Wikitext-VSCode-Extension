/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Rowe Wilson Frederisk Holme. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as MWBot from 'mwbot';
import * as vscode from 'vscode';
import * as querystring from 'querystring';
import { IncomingMessage } from 'http';
import * as xml2js from 'xml2js';
import { action, prop, format, rvprop, alterNativeValues } from './mediawiki';
import { getHost } from '../host_function/host';
import { ReadPageConvert, ReadPageResult } from '../../interface_definition/readPageInterface';
import { sendRequest } from '../private_function/mwrequester';
import { GetViewResult, GetViewConvert } from '../../interface_definition/getViewInterface';

let bot: MWBot | null = null;
let pageName: string | undefined = "";

export function login(): void {
    const config: vscode.WorkspaceConfiguration = vscode.workspace.getConfiguration("wikitext");

    const host: string | undefined = getHost();
    if (!host) { return undefined; }

    const userName: string | undefined = config.get("userName");
    const password: string | undefined = config.get("password");
    if (!userName || !password) {
        vscode.window.showWarningMessage("You have not filled in the user name or password, please go to the settings and try again.");
        return undefined;
    }

    bot = new MWBot({
        apiUrl: "https://" + host + config.get("apiPath")
    });

    bot?.login({
        username: userName,
        password: password
    }).then((response) => {
        console.log(response);
        vscode.window.showInformationMessage(`User "${response.lgusername}"(UserID:"${response.lguserid}") Login Result is "${response.result}". Login Token is "${response.token}".`
        );
    }).catch((err: Error) => {
        console.log(err);
        vscode.window.showErrorMessage(err.message);
    });
}

export function logout(): void {
    bot = null;
    vscode.window.showInformationMessage("result: \"Success\"");
}

/**
 * Write Page
 */
export async function writePage() {
    const wikiContent: string | undefined = vscode.window.activeTextEditor?.document.getText();
    if (wikiContent === undefined) {
        vscode.window.showWarningMessage("There is no active text editor.");
        return undefined;
    }

    if (bot === null) {
        vscode.window.showWarningMessage("You are not logged in. Please log in and try again.");
        return undefined;
    }

    const wikiTitle: string | undefined = await vscode.window.showInputBox({
        value: pageName,
        ignoreFocusOut: true,
        password: false,
        prompt: "Enter the page name here."
    });

    if (!wikiTitle) { return undefined; }

    let wikiSummary: string | undefined = await vscode.window.showInputBox({
        value: "",
        ignoreFocusOut: false,
        password: false,
        prompt: "Enter the summary of this edit action."
    });
    wikiSummary += " // Edit via Wikitext Extension for Visual Studio Code";

    // let editStatus: string = "";
    await bot.getEditToken().then(response => {
        vscode.window.showInformationMessage(
            `Get edit token status is "${response.result}". User "${response.lgusername}" (User ID: "${response.lguserid}") got the token: "${response.token}" and csrftoken: "${response.csrftoken}".`
        );
    }).catch((err: Error) => {
        vscode.window.showErrorMessage(err.name);
    });

    await bot.edit(wikiTitle, wikiContent, wikiSummary).then(response => {
        if (response.edit.nochange !== undefined) {
            vscode.window.showWarningMessage(
                `No changes have occurred: "${response.edit.nochange}", Edit page "${response.edit.title}" (Page ID: "${response.edit.pageid}") action status is "${response.edit.result}" with Content Model "${response.edit.contentmodel}". Watched by: "${response.edit.watched}".`
            );
        }
        else {
            vscode.window.showInformationMessage(
                `Edit page "${response.edit.title}" (Page ID: "${response.edit.pageid}") action status is "${response.edit.result}" with Content Model "${response.edit.contentmodel}" (Version: "${response.edit.oldrevid}" => "${response.edit.newrevid}", Time: "${response.edit.newtimestamp}"). Watched by: "${response.edit.watched}".`
            );
        }
    });
}

/**
 * Read Page
 */
export async function readPage(): Promise<void> {
    const config: vscode.WorkspaceConfiguration = vscode.workspace.getConfiguration("wikitext");

    const title: string | undefined = await vscode.window.showInputBox({
        prompt: "Enter the page name here."
    });
    if (!title) {
        return undefined;
    }

    const queryInput: querystring.ParsedUrlQueryInput = {
        action: action.query,
        format: format.xml,
        prop: prop.reVisions,
        rvprop: alterNativeValues(rvprop.content, rvprop.ids),
        rvslots: "*",
        titles: title
    };

    if (config.get("redirects")) {
        queryInput.redirects = "true";
    }

    sendRequest(queryInput, requestCallback);

    function requestCallback(response: IncomingMessage) {
        const chunks: Uint8Array[] = [];

        response.on('data', data => {
            console.log(response.statusCode);
            chunks.push(data);
        });

        response.on('end', () => {
            // result.
            const xmltext: string = Buffer.concat(chunks).toString();
            xml2js.parseString(xmltext, async (err: Error, result: any) => {
                console.log(result);
                const re: ReadPageResult = ReadPageConvert.toReadPageResult(result);

                // interwiki
                if (re.api?.query?.[0].interwiki !== undefined) {
                    vscode.window.showWarningMessage(
                        `Interwiki page "${re.api.query[0].interwiki?.[0].i?.[0].$?.title}" in space "${re.api.query[0].interwiki?.[0].i?.[0].$?.iw}" are currently not supported. Please try to modify host.`
                    );
                    return undefined;
                }

                // need page
                if (!re.api?.query?.[0].pages?.[0].page) { return undefined; }
                // not exist
                const wikiTitle = re.api.query[0].pages[0].page[0].$?.title;
                if (re.api.query[0].pages[0].page[0].$?.missing !== undefined ||
                    re.api.query[0].pages[0].page[0].$?.invalid !== undefined) {
                    vscode.window.showWarningMessage(
                        `The page "${wikiTitle}" you are looking for does not exist.` +
                        re.api.query[0].pages[0].page[0].$?.invalidreason || ``
                    );
                    return undefined;
                }

                // show doc
                const wikiContent = re.api.query[0].pages[0].page[0].revisions?.[0].rev?.[0].slots?.[0].slot?.[0]._;
                const wikiModel = re.api.query[0].pages[0].page[0].revisions?.[0].rev?.[0].slots?.[0].slot?.[0].$?.contentmodel;
                console.log(wikiModel);
                await vscode.workspace.openTextDocument({
                    language: wikiModel,
                    content: wikiContent
                });

                console.log(wikiTitle);
                //TODO: update pagename
                pageName = wikiTitle;

                // show info
                const wikiPageID = re.api.query[0].pages[0].page[0].$?.pageid;
                const wikiNormalized = re.api.query[0].normalized?.[0].n?.[0].$;
                const wikiRedirect = re.api.query[0].redirects?.[0].r?.[0].$;
                vscode.window.showInformationMessage(`Opened page "${wikiTitle}" (page ID:"${wikiPageID}") with Model ${wikiModel}.` + (wikiNormalized ? ` Normalized: "${wikiNormalized.from}" => "${wikiNormalized.to}".` : ``) + (wikiRedirect ? ` Redirect: "${wikiRedirect?.from}" => "${wikiRedirect.to}"` : ``));
            });
        });

        response.on('error', (error: Error) => {
            vscode.window.showErrorMessage(error.name);
        });
    }
}

export async function viewPage(): Promise<void> {
    const config: vscode.WorkspaceConfiguration = vscode.workspace.getConfiguration("wikitext");
    const pageTitle: string | undefined = await vscode.window.showInputBox({
        prompt: "Enter the page name here."
    });
    if (!pageTitle) {
        return undefined;
    }

    const queryInput: querystring.ParsedUrlQueryInput = {
        action: action.parse,
        format: format.json,
        page: pageTitle,
        prop: alterNativeValues(prop.text, prop.displayTitle, (config.get("getCss") ? prop.headHTML : undefined)),
    };
    if (config.get("redirects")) {
        queryInput.redirects = "true";
    }
    console.log(queryInput);

    sendRequest(queryInput, requestCallback);

    function requestCallback(response: IncomingMessage): void {
        let currentPlanel: vscode.WebviewPanel = vscode.window.createWebviewPanel("pageViewer", "PageViewer", vscode.ViewColumn.Active, {
            enableScripts: config.get("enableJavascript"),
        });

        const chunks: Uint8Array[] = [];

        response.on('data', data => {
            console.log(response.statusCode);
            chunks.push(data);
        });

        response.on('end', () => {
            // result.
            const result: string = Buffer.concat(chunks).toString();
            //const re: any = JSON.parse(result);
            const re: GetViewResult = GetViewConvert.toGetViewResult(JSON.parse(result));
            console.log(re);

            if (re.error) {
                vscode.window.showErrorMessage(`${re.error.code}! ${re.error.info}`);
                return undefined;
            }
            else if (re.parse) {
                // const wikiContent: string = unescape(re["parse"]["text"]["*"]);
                const header: string = config.get("getCss") ? (re.parse.headhtml?.["*"] || ``) : `<!DOCTYPE html><html><body>`;
                const end: string = `</body></html>`;

                if (!currentPlanel) { return undefined; }
                // if (wikiContent && header) {
                currentPlanel.webview.html = header + re.parse.text?.["*"] + end;
                currentPlanel.title = `WikitextPreviewer: ${re.parse.displaytitle}`;
                // }
                // else {
                //     currentPlanel.dispose();
                //     vscode.window.showErrorMessage("Error.");
                // }
            }
        });

        response.on('error', (error: Error) => {
            vscode.window.showErrorMessage(error.name);
        });
    }
}

export function uploadFile(): void {

}

export function deletedPage(): void {

}
