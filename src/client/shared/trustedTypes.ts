export default function (client, self) {
	delete self.TrustedHTML;
	delete self.TrustedScript;
	delete self.TrustedScriptURL;
	delete self.TrustedTypePolicy;
	delete self.TrustedTypePolicyFactory;
	delete self.trustedTypes;
}