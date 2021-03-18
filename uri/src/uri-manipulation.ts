/* eslint-disable no-useless-escape */
import { homedir } from "os";
import { URL } from "url";
import * as URI from "urijs";
import * as fileUri from "file-url";

export function simplifyUri(uri: string): string {
  try {
    return new URL(uri).toString();
  } catch (e) {
    try {
      // Try with null protocol
      return new URL(`null://${uri}`).toString();
    } catch {
      // Throw original error
      throw e;
    }
  }
}

export function IsUri(uri: string): boolean {
  return /^([a-z0-9+.-]+):(?:\/\/(?:((?:[a-z0-9-._~!$&'()*+,;=:]|%[0-9A-F]{2})*)@)?((?:[a-z0-9-._~!$&'()*+,;=]|%[0-9A-F]{2})*)(?::(\d*))?(\/(?:[a-z0-9-._~!$&'()*+,;=:@/]|%[0-9A-F]{2})*)?|(\/?(?:[a-z0-9-._~!$&'()*+,;=:@]|%[0-9A-F]{2})+(?:[a-z0-9-._~!$&'()*+,;=:@/]|%[0-9A-F]{2})*)?)(?:\?((?:[a-z0-9-._~!$&'()*+,;=:/?@]|%[0-9A-F]{2})*))?(?:#((?:[a-z0-9-._~!$&'()*+,;=:/?@]|%[0-9A-F]{2})*))?$/i.test(
    uri,
  );
}

/**
 *  remake of path.isAbsolute... because it's platform dependent:
 * Windows: C:\\... -> true    /... -> true
 * Linux:   C:\\... -> false   /... -> true
 */
function isAbsolute(path: string): boolean {
  return !!path.match(/^([a-zA-Z]:)?(\/|\\)/);
}

/**
 * determines what an absolute URI is for our purposes, consider:
 * - we had Ruby try to use "Azure::ARM::SQL" as a file name, so that should not be considered absolute
 * - we want simple, easily predictable semantics
 */
function isUriAbsolute(url: string): boolean {
  return /^[a-z]+:\/\//.test(url);
}

/**
 * Create a 'file:///' URI from given absolute path.
 * Examples:
 * - "C:\swagger\storage.yaml" -> "file:///C:/swagger/storage.yaml"
 * - "/input/swagger.yaml" -> "file:///input/swagger.yaml"
 */
export function CreateFileOrFolderUri(absolutePath: string): string {
  if (!isAbsolute(absolutePath)) {
    throw new Error(`Can only create file URIs from absolute paths. Got '${absolutePath}'`);
  }
  let result = fileUri(absolutePath, { resolve: false });
  // handle UNCs
  if (absolutePath.startsWith("//") || absolutePath.startsWith("\\\\")) {
    result = result.replace(/^file:\/\/\/\//, "file://");
  }
  return result;
}

export function EnsureIsFileUri(uri: string): string {
  return uri.replace(/\/$/g, "");
}

export function EnsureIsFolderUri(uri: string): string {
  return EnsureIsFileUri(uri) + "/";
}
export function CreateFileUri(absolutePath: string): string {
  return EnsureIsFileUri(CreateFileOrFolderUri(absolutePath));
}
export function CreateFolderUri(absolutePath: string): string {
  return EnsureIsFolderUri(CreateFileOrFolderUri(absolutePath));
}

export function GetFilename(uri: string): string {
  return uri.split("/").reverse()[0].split("\\").reverse()[0];
}

export function GetFilenameWithoutExtension(uri: string): string {
  const lastPart = GetFilename(uri);
  const ext = lastPart.indexOf(".") === -1 ? "" : lastPart.split(".").reverse()[0];
  return lastPart.substr(0, lastPart.length - ext.length - 1);
}

export function ToRawDataUrl(uri: string): string {
  uri = simplifyUri(uri);

  // special URI handlers (the 'if's shouldn't be necessary but provide some additional isolation in case there is anything wrong with one of the regexes)
  // - GitHub repo
  if (uri.startsWith("https://github.com")) {
    uri = uri.replace(
      /^https?:\/\/(github.com)(\/[^\/]+\/[^\/]+\/)(blob|tree)\/(.*)$/gi,
      "https://raw.githubusercontent.com$2$4",
    );
  }
  // - GitHub gist
  if (uri.startsWith("gist://")) {
    uri = uri.replace(/^gist:\/\/([^\/]+\/[^\/]+)$/gi, "https://gist.githubusercontent.com/$1/raw/");
  }
  if (uri.startsWith("https://gist.github.com")) {
    uri = uri.replace(/^https?:\/\/gist.github.com\/([^\/]+\/[^\/]+)$/gi, "https://gist.githubusercontent.com/$1/raw/");
  }
  if (uri.startsWith("null://")) {
    uri = uri.substr(7);
  }

  return uri;
}

/**
 * The singularity of all resolving.
 * With URI as our one data type of truth, this method maps an absolute or relative path or URI to a URI using given base URI.
 * @param baseUri   Absolute base URI
 * @param pathOrUri Relative/absolute path/URI
 * @returns Absolute URI
 */
export function ResolveUri(baseUri: string, pathOrUri: string): string {
  if (pathOrUri.startsWith("~/")) {
    pathOrUri = pathOrUri.replace(/^~/, homedir());
  }
  if (isAbsolute(pathOrUri)) {
    return CreateFileOrFolderUri(pathOrUri);
  }

  // known here: `pathOrUri` is eiher URI (relative or absolute) or relative path - which we can normalize to a relative URI
  pathOrUri = pathOrUri.replace(/\\/g, "/");
  // known here: `pathOrUri` is a URI (relative or absolute)
  if (isUriAbsolute(pathOrUri)) {
    return pathOrUri;
  }
  // known here: `pathOrUri` is a relative URI
  if (!baseUri) {
    throw new Error("'pathOrUri' was detected to be relative so 'baseUri' is required");
  }
  try {
    const base = new URI(baseUri);
    const relative = new URI(pathOrUri);
    if (baseUri.startsWith("untitled:///") && pathOrUri.startsWith("untitled:")) {
      return pathOrUri;
    }
    const result = relative.absoluteTo(base);
    // GitHub simple token forwarding, for when you pass a URI to a private repo file with `?token=` query parameter.
    // this may be easier for quick testing than getting and passing an OAuth token.
    if (
      base.protocol() === "https" &&
      base.hostname() === "raw.githubusercontent.com" &&
      result.protocol() === "https" &&
      result.hostname() === "raw.githubusercontent.com"
    ) {
      result.query(base.query());
    }

    return simplifyUri(result.toString());
  } catch (e) {
    throw new Error(`Failed resolving '${pathOrUri}' against '${baseUri}'.`);
  }
}

export function ParentFolderUri(uri: string): string | null {
  // root?
  if (uri.endsWith("//")) {
    return null;
  }
  // folder? => cut away last "/"
  if (uri.endsWith("/")) {
    uri = uri.slice(0, uri.length - 1);
  }
  // cut away last component
  const compLen = uri.split("/").reverse()[0].length;
  return uri.slice(0, uri.length - compLen);
}

export function MakeRelativeUri(baseUri: string, absoluteUri: string): string {
  return new URI(absoluteUri).relativeTo(baseUri).toString();
}
